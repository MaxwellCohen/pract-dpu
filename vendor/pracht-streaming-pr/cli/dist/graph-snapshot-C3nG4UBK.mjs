import { a as formatBytes } from "./bundle-report-lW_Uk3V5.mjs";
import { a as readProjectConfig, c as resolveProjectPath } from "./project-C-2I9C0N.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createServer, resolveConfig } from "vite";
import { destructiveMcpSetupMiddlewareFiles, resolveMcpEndpoint, resolveRegistryModule, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities, servesDestructiveMcpTools } from "@pracht/core";
import { PRACHT_GRAPH_ONLY_ENV, loadMcpTokenVerifier } from "@pracht/core/server";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
//#region src/app-graph.ts
const PRACHT_DEV_METADATA_MODULE_ID = "virtual:pracht/dev-metadata";
/**
* Adapter-neutral app metadata (`resolvedApp`, `apiRoutes`, `registry`,
* `buildTarget`) for graph-reading commands. It comes from a dedicated virtual
* module rather than the adapter's server entry because that entry can pull in
* imports Vite's Node SSR environment cannot resolve — Cloudflare Durable
* Objects re-exported through `workerExportsFrom` import `cloudflare:workers`,
* which only exists inside workerd.
*/
async function loadAppMetadataModule(server) {
	try {
		return await server.ssrLoadModule(PRACHT_DEV_METADATA_MODULE_ID);
	} catch (error) {
		if (!isMissingDevMetadataModule(error)) throw error;
		return server.ssrLoadModule("virtual:pracht/server");
	}
}
function isMissingDevMetadataModule(error) {
	return error instanceof Error && "code" in error && error.code === "ERR_LOAD_URL" && error.message.includes(`Failed to load url ${PRACHT_DEV_METADATA_MODULE_ID} (resolved id: ${PRACHT_DEV_METADATA_MODULE_ID})`);
}
/**
* Load the resolved app graph (page routes + API routes) from a running Vite
* dev server. Shared by `pracht inspect` and the `pracht dev` startup banner.
*/
async function collectAppGraph(server, root, options = {}) {
	const serverModule = await loadAppMetadataModule(server);
	const notFound = serverModule.resolvedApp.notFound;
	const capabilityGraph = await collectCapabilityAppGraph(server, root, serverModule, options);
	return {
		api: await serializeApiRoutesStatic(serverModule.apiRoutes, {
			readSource: (file) => readStaticAppModule(root, file),
			resolveModule: (specifier, importer) => resolveStaticModule(server, root, specifier, importer)
		}),
		...capabilityGraph,
		notFound: notFound ? serializeResolvedRoutes([notFound])[0] : null,
		routes: serializeResolvedRoutes(serverModule.resolvedApp.routes)
	};
}
/**
* Resolve capability contracts together with the effective remote MCP runtime
* status. Callers that already loaded the app metadata module can share that
* exact Vite module graph, including process-local approval registrations.
*/
async function collectCapabilityAppGraph(server, root, serverModule, options = {}) {
	const capabilities = await serializeCapabilities(serverModule.resolvedApp.capabilities, {
		loadModule: capabilityModuleLoader(server, serverModule),
		readSource: createSourceReader(root, options.appFile ?? "/src/routes.ts")
	}, { strict: options.strict ?? false });
	const mcpEndpoint = resolveMcpEndpoint(serverModule.resolvedApp.agents);
	const capabilityFailures = mcpEndpoint === null ? [] : capabilities.flatMap((capability) => capability.error ? [`Capability ${JSON.stringify(capability.name)} failed to load: ${capability.error}`] : []);
	const mcpDestructive = servesDestructiveMcpTools(serverModule.resolvedApp, capabilities);
	const verifierFailure = await readMcpTokenVerifierFailure(serverModule);
	let setupFailure = null;
	if (mcpDestructive) try {
		await loadDestructiveMcpSetupModules(server, serverModule, capabilities);
	} catch (error) {
		setupFailure = `destructive MCP setup modules failed to load: ${error instanceof Error ? error.message : String(error)}`;
	}
	const mcpUnavailableReasons = [
		...capabilityFailures,
		...verifierFailure === null ? [] : [verifierFailure],
		...setupFailure !== null ? [setupFailure] : mcpDestructive ? await readDestructiveMcpPreconditionErrors(server, serverModule.resolvedApp.agents) : []
	];
	return {
		capabilities,
		mcpEndpoint,
		mcpDestructive,
		mcpAuthenticated: !!serverModule.resolvedApp.agents?.mcp?.auth,
		mcpRuntimeStatus: mcpEndpoint === null ? "not-configured" : verifierFailure !== null ? "blocked" : mcpUnavailableReasons.length > 0 ? "unverified" : "ready",
		mcpUnavailableReasons
	};
}
async function readMcpTokenVerifierFailure(serverModule) {
	const auth = serverModule.resolvedApp.agents?.mcp?.auth;
	if (!auth) return null;
	try {
		await loadMcpTokenVerifier(auth, serverModule.registry ?? {});
		return null;
	} catch (error) {
		return `MCP token verifier failed to load: ${error instanceof Error ? error.message : String(error)}`;
	}
}
async function loadDestructiveMcpSetupModules(server, serverModule, capabilities) {
	const files = destructiveMcpSetupMiddlewareFiles(serverModule.resolvedApp, capabilities);
	const middlewareModules = serverModule.registry?.middlewareModules;
	await Promise.all(files.map(async (file) => {
		if (!await resolveRegistryModule(middlewareModules, file)) await server.ssrLoadModule(file);
	}));
}
async function readDestructiveMcpPreconditionErrors(server, agents) {
	const check = (await server.ssrLoadModule("@pracht/core/server")).destructiveMcpPreconditionErrors;
	if (typeof check !== "function") throw new Error("@pracht/core/server does not export destructiveMcpPreconditionErrors(). Update @pracht/core and @pracht/cli together.");
	return check(agents);
}
function readStaticAppModule(root, file) {
	const resolved = resolveInRootAppFile(root, resolve(root, `.${file}`));
	if (!resolved) throw new Error(`Static app module is outside the project root: ${file}`);
	return readFileSync(resolved.absolute, "utf-8");
}
async function resolveStaticModule(server, root, specifier, importer) {
	const importerFile = resolveInRootAppFile(root, resolve(root, `.${importer}`));
	if (!importerFile) return null;
	const resolved = await server.pluginContainer.resolveId(specifier, importerFile.absolute, { ssr: true });
	if (!resolved) return null;
	if (typeof resolved !== "string" && resolved.external) return null;
	const cleanId = (typeof resolved === "string" ? resolved : resolved.id).split("?", 1)[0].split("#", 1)[0];
	if (cleanId.startsWith("\0") || cleanId.startsWith("virtual:")) return null;
	return resolveInRootAppFile(root, cleanId)?.appPath ?? null;
}
function resolveInRootAppFile(root, candidate) {
	try {
		const canonicalRoot = realpathSync.native(root);
		const absolute = realpathSync.native(candidate);
		if (!statSync(absolute).isFile()) return null;
		const relativePath = relative(canonicalRoot, absolute);
		if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.split(sep).includes("node_modules")) return null;
		return {
			absolute,
			appPath: `/${relativePath.split(sep).join("/")}`
		};
	} catch {
		return null;
	}
}
/**
* Manifest capability paths are relative to the app file (e.g.
* `./capabilities/notes-search.ts`), so they only load through the virtual
* server module's registry, which suffix-matches them against its glob keys.
* Fall back to a direct ssrLoadModule for absolute/root-relative paths.
*/
/**
* Read a module's source given the path shape the graph reports.
*
* API and route files are root-relative (`/src/api/health.ts`); capability
* files come from the manifest and are manifest-relative
* (`./capabilities/kv-get.ts`). Resolving the latter with the root-relative
* rule walks *above* the project, so the read fails — and every consumer that
* falls back to reading source (the static capability projection) silently got
* nothing.
*/
function createSourceReader(root, appFile) {
	const manifestDir = dirname(resolve(root, `.${appFile}`));
	return (file) => readFileSync(file.startsWith("/") ? resolve(root, `.${file}`) : resolve(manifestDir, file), "utf-8");
}
function capabilityModuleLoader(server, serverModule) {
	const registry = serverModule.registry;
	return async (file) => {
		return await resolveRegistryModule(registry?.capabilityModules, file) ?? server.ssrLoadModule(file);
	};
}
function serializeResolvedRoutes(routes) {
	return routes.map((route) => ({
		file: route.file,
		hydration: route.hydration ?? null,
		id: route.id,
		loaderCache: route.loaderCache ?? null,
		loaderFile: route.loaderFile ?? null,
		...route.markdown === true ? { markdown: true } : {},
		middleware: route.middleware,
		path: route.path,
		prefetch: route.prefetch ?? null,
		render: route.render ?? null,
		revalidate: route.revalidate ?? null,
		shell: route.shell ?? null,
		shellFile: route.shellFile ?? null,
		speculation: route.speculation ?? null,
		streaming: route.streaming ?? null
	}));
}
//#endregion
//#region src/app-server.ts
/** Read the version-compatible metadata exposed by the resolved pracht plugin. */
function readBuildLlmsTxtEnabled(plugins) {
	const enabled = plugins.find((plugin) => plugin.name === "pracht")?.api?.llmsTxtEnabled;
	return typeof enabled === "boolean" ? enabled : null;
}
/**
* Resolve the same production SSR configuration that emits `generateLlmsTxt`.
* A normal graph server uses Vite's `serve` command and development mode, so
* reading its options would misreport build- or production-only configuration.
*/
async function resolveBuildLlmsTxtEnabled(root) {
	const releaseStartup = await acquireGraphStartup();
	try {
		enterGraphOnlyMode();
		const previousNodeEnv = process.env.NODE_ENV;
		try {
			return readBuildLlmsTxtEnabled((await resolveConfig({
				root,
				logLevel: "silent",
				build: {
					copyPublicDir: false,
					rollupOptions: { input: "virtual:pracht/server" },
					ssr: true
				}
			}, "build", "production", "production")).plugins);
		} finally {
			if (previousNodeEnv === void 0) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = previousNodeEnv;
			exitGraphOnlyMode();
		}
	} finally {
		releaseStartup();
	}
}
/**
* Boot a silent middleware-mode Vite server for the app at `root`, load the
* app's resolved graph metadata, run `fn`, and always close the server.
* Shared by `pracht inspect`, `pracht plan`, and graph-aware verification so
* they all observe the exact same resolved app graph.
*/
async function withAppServer(root, fn) {
	const project = readProjectConfig(root);
	if (!project.configFile) throw new Error("Missing vite config. This command requires a project with pracht configured.");
	if (!project.hasPrachtPlugin) throw new Error("vite.config does not appear to register the pracht plugin.");
	if (project.mode === "manifest") {
		if (!existsSync(resolveProjectPath(project.root, project.appFile))) throw new Error(`App manifest is missing at ${project.appFile}.`);
	}
	const cacheDir = mkdtempSync(join(tmpdir(), "pracht-graph-"));
	let server;
	let releaseOperation;
	try {
		const viteConfig = {
			cacheDir,
			root,
			logLevel: "silent",
			optimizeDeps: { noDiscovery: true },
			server: { middlewareMode: true }
		};
		const releaseStartup = await acquireGraphStartup();
		try {
			enterGraphOnlyMode();
			try {
				server = await createServer(viteConfig);
			} finally {
				exitGraphOnlyMode();
			}
		} finally {
			releaseStartup();
		}
		releaseOperation = await acquireGraphOperation();
		const serverModule = await loadAppMetadataModule(server);
		return await fn({
			project,
			server,
			serverModule
		});
	} finally {
		try {
			await server?.close();
		} finally {
			try {
				rmSync(cacheDir, {
					force: true,
					maxRetries: 3,
					recursive: true,
					retryDelay: 50
				});
			} catch {}
			releaseOperation?.();
		}
	}
}
let graphOperationCount = 0;
let graphStartupActive = false;
const graphGateQueue = [];
function releaseOnce(release) {
	let released = false;
	return () => {
		if (released) return;
		released = true;
		release();
	};
}
function releaseGraphOperation() {
	graphOperationCount -= 1;
	if (graphOperationCount === 0) drainGraphGate();
}
function releaseGraphStartup() {
	graphStartupActive = false;
	drainGraphGate();
}
function drainGraphGate() {
	if (graphStartupActive || graphOperationCount > 0 || graphGateQueue.length === 0) return;
	if (graphGateQueue[0].kind === "startup") {
		graphStartupActive = true;
		graphGateQueue.shift().resolve(releaseOnce(releaseGraphStartup));
		return;
	}
	while (graphGateQueue[0]?.kind === "operation") {
		graphOperationCount += 1;
		graphGateQueue.shift().resolve(releaseOnce(releaseGraphOperation));
	}
}
function acquireGraphGate(kind) {
	if (graphGateQueue.length === 0 && !graphStartupActive && (kind === "operation" || graphOperationCount === 0)) {
		if (kind === "startup") {
			graphStartupActive = true;
			return Promise.resolve(releaseOnce(releaseGraphStartup));
		}
		graphOperationCount += 1;
		return Promise.resolve(releaseOnce(releaseGraphOperation));
	}
	return new Promise((resolve) => {
		graphGateQueue.push({
			kind,
			resolve
		});
	});
}
function acquireGraphStartup() {
	return acquireGraphGate("startup");
}
function acquireGraphOperation() {
	return acquireGraphGate("operation");
}
/**
* Startup is exclusive because the flag has to outlive the complete
* `createServer()` call without becoming visible to app module evaluation.
*
* The pracht plugin reads it while Vite bundles and evaluates the app's
* config, which is asynchronous. Restoring as soon as one `createServer()`
* resolved therefore let a second, overlapping call load the adapter's Vite
* plugins after all — booting workerd in a "graph-only" server and hanging the
* process, which is precisely what this mode exists to avoid. The MCP server
* is the realistic trigger: it serves inspect/verify/plan/typegen from one
* long-lived process.
*
* The original value is restored before the server receives its shared
* operation lease, so app modules and child processes never inherit `"1"`.
*/
let graphOnlyDepth = 0;
let graphOnlyPrevious;
function enterGraphOnlyMode() {
	if (graphOnlyDepth === 0) {
		graphOnlyPrevious = process.env[PRACHT_GRAPH_ONLY_ENV];
		process.env[PRACHT_GRAPH_ONLY_ENV] = "1";
	}
	graphOnlyDepth += 1;
}
function exitGraphOnlyMode() {
	graphOnlyDepth -= 1;
	if (graphOnlyDepth > 0) return;
	graphOnlyDepth = 0;
	if (graphOnlyPrevious === void 0) delete process.env[PRACHT_GRAPH_ONLY_ENV];
	else process.env[PRACHT_GRAPH_ONLY_ENV] = graphOnlyPrevious;
	graphOnlyPrevious = void 0;
}
//#endregion
//#region src/graph-snapshot.ts
/**
* The app-graph snapshot is a committed, canonical serialization of the
* resolved route graph (`.pracht/app-graph.json`) — a route-graph lockfile.
* `pracht plan` diffs the live graph against the snapshot at a base git ref
* to produce an intent-level changelog, and `pracht verify` fails when the
* snapshot is stale, so the committed snapshot is always trustworthy.
*/
const GRAPH_SNAPSHOT_PATH = ".pracht/app-graph.json";
async function resolveLiveGraphMetadata(root) {
	return withAppServer(root, async ({ project, server, serverModule }) => {
		const resolvedRoutes = serverModule.resolvedApp.routes;
		await assertMcpTokenVerifierModule(serverModule);
		const routes = serializeAppRoutes(resolvedRoutes);
		const api = await serializeApiRoutes(serverModule.apiRoutes, {
			loadModule: (file) => server.ssrLoadModule(file),
			readSource: (file) => readFileSync(resolve(root, `.${file}`), "utf-8")
		}, { strict: true });
		const capabilities = await serializeCapabilities(serverModule.resolvedApp.capabilities, {
			loadModule: capabilityModuleLoader(server, serverModule),
			readSource: createSourceReader(root, project.appFile)
		}, { strict: true });
		return {
			graph: normalizeGraphSnapshot({
				prachtGraphVersion: 2,
				mode: project.mode,
				routes,
				api,
				capabilities,
				mcpEndpoint: resolveMcpEndpoint(serverModule.resolvedApp.agents),
				...servesDestructiveMcpTools(serverModule.resolvedApp, capabilities) ? { mcpDestructive: true } : {},
				mcpAuthenticated: !!serverModule.resolvedApp.agents?.mcp?.auth,
				mcpAuth: serializeMcpAuth(serverModule.resolvedApp.agents?.mcp?.auth),
				constraints: serverModule.resolvedApp.constraints ?? []
			}),
			loaderRoutePaths: new Set(resolvedRoutes.filter((route) => route.loaderFile !== void 0 || route.hasLoader !== false).map((route) => route.path)),
			staticTarget: serverModule.staticTarget === true
		};
	});
}
async function assertMcpTokenVerifierModule(serverModule) {
	const auth = serverModule.resolvedApp.agents?.mcp?.auth;
	if (!auth) return;
	await loadMcpTokenVerifier(auth, serverModule.registry);
}
async function resolveLiveGraph(root) {
	return (await resolveLiveGraphMetadata(root)).graph;
}
/**
* Strip the diagnostic `error` field before a capability enters the committed
* snapshot.
*
* The snapshot is compared byte-for-byte against `.pracht/app-graph.json` to
* decide staleness, so serializing a new field would mark every committed
* snapshot stale on upgrade with no real graph change. It also has no business
* being committed: it is a local wiring failure, not app shape, and its message
* carries absolute machine paths. It stays available on `pracht inspect
* capabilities` and the dev banner, where it is actionable.
*/
function withoutLoadError(capability) {
	if (capability.error == null) return capability;
	const { error: _error, ...rest } = capability;
	return rest;
}
/** Stable ordering + JSON round-trip so snapshots diff cleanly in git. */
function normalizeGraphSnapshot(snapshot) {
	const normalized = {
		prachtGraphVersion: snapshot.prachtGraphVersion,
		mode: snapshot.mode,
		routes: snapshot.routes.map((route) => ({
			...route,
			streaming: route.streaming ?? null
		})).sort((left, right) => left.path.localeCompare(right.path)),
		api: [...snapshot.api].sort((left, right) => left.path.localeCompare(right.path)),
		capabilities: [...snapshot.capabilities ?? []].sort((left, right) => left.name.localeCompare(right.name)),
		mcpEndpoint: snapshot.mcpEndpoint ?? null,
		...snapshot.mcpDestructive === true ? { mcpDestructive: true } : {},
		mcpAuthenticated: snapshot.mcpAuthenticated ?? false,
		mcpAuth: snapshot.mcpAuth ?? null,
		constraints: snapshot.constraints ?? []
	};
	return JSON.parse(JSON.stringify(normalized));
}
function serializeMcpAuth(auth) {
	if (!auth || typeof auth.verify !== "string") return null;
	return {
		authorizationServers: [...auth.authorizationServers],
		requiredScopes: [...auth.requiredScopes ?? []],
		resource: auth.resource,
		scopesSupported: [...auth.scopesSupported ?? []],
		verify: auth.verify
	};
}
function serializeGraphSnapshot(snapshot) {
	const normalized = normalizeGraphSnapshot(snapshot);
	return `${JSON.stringify({
		...normalized,
		capabilities: normalized.capabilities.map(withoutLoadError)
	}, null, 2)}\n`;
}
function writeGraphSnapshot(root, snapshot) {
	const filePath = resolve(root, GRAPH_SNAPSHOT_PATH);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, serializeGraphSnapshot(snapshot), "utf-8");
	return filePath;
}
function readGraphSnapshotFromDisk(root) {
	const filePath = resolve(root, GRAPH_SNAPSHOT_PATH);
	if (!existsSync(filePath)) return null;
	return parseSnapshot(readFileSync(filePath, "utf-8"));
}
function runGit(root, args) {
	try {
		return execFileSync("git", [
			"-C",
			root,
			...args
		], {
			encoding: "utf-8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		});
	} catch {
		return null;
	}
}
/** Read the committed snapshot at a git ref, reporting *why* it is absent. */
function resolveBaseSnapshot(root, ref) {
	const prefix = runGit(root, ["rev-parse", "--show-prefix"]);
	if (prefix === null) return {
		status: "not-a-repo",
		snapshot: null
	};
	if (runGit(root, [
		"rev-parse",
		"--verify",
		"--quiet",
		`${ref}^{commit}`
	]) === null) return {
		status: "missing-ref",
		snapshot: null
	};
	const contents = runGit(root, ["show", `${ref}:${prefix.trim()}${GRAPH_SNAPSHOT_PATH}`]);
	if (contents === null) return {
		status: "no-snapshot",
		snapshot: null
	};
	const snapshot = parseSnapshot(contents);
	return snapshot ? {
		status: "ok",
		snapshot
	} : {
		status: "no-snapshot",
		snapshot: null
	};
}
function parseSnapshot(contents) {
	try {
		const parsed = JSON.parse(contents);
		if (!parsed || !Array.isArray(parsed.routes) || !Array.isArray(parsed.api)) return null;
		return {
			prachtGraphVersion: parsed.prachtGraphVersion ?? 2,
			mode: parsed.mode ?? "manifest",
			routes: parsed.routes,
			api: parsed.api,
			capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
			mcpEndpoint: typeof parsed.mcpEndpoint === "string" ? parsed.mcpEndpoint : null,
			...parsed.mcpDestructive === true ? { mcpDestructive: true } : {},
			mcpAuthenticated: parsed.mcpAuthenticated === true,
			mcpAuth: parseMcpAuthSnapshot(parsed.mcpAuth),
			constraints: Array.isArray(parsed.constraints) ? parsed.constraints : []
		};
	} catch {
		return null;
	}
}
function parseMcpAuthSnapshot(value) {
	const record = asRecord(value);
	if (typeof record.resource !== "string" || typeof record.verify !== "string" || !Array.isArray(record.authorizationServers) || !record.authorizationServers.every((entry) => typeof entry === "string") || !Array.isArray(record.requiredScopes) || !record.requiredScopes.every((entry) => typeof entry === "string") || !Array.isArray(record.scopesSupported) || !record.scopesSupported.every((entry) => typeof entry === "string")) return null;
	return {
		authorizationServers: record.authorizationServers,
		requiredScopes: record.requiredScopes,
		resource: record.resource,
		scopesSupported: record.scopesSupported,
		verify: record.verify
	};
}
const ROUTE_DIFF_FIELDS = [
	"render",
	"hydration",
	"shell",
	"middleware",
	"file",
	"loaderFile",
	"loaderCache",
	"streaming",
	"markdown",
	"revalidate",
	"id"
];
function diffGraphSnapshots(base, head) {
	const routeDiff = diffByPath(base.routes, head.routes, (left, right) => collectFieldChanges(left, right, ROUTE_DIFF_FIELDS));
	const apiDiff = diffByPath(base.api, head.api, (left, right) => collectFieldChanges(left, right, ["methods", "file"]));
	const baseConstraints = new Set(base.constraints.map((entry) => JSON.stringify(entry)));
	const headConstraints = new Set(head.constraints.map((entry) => JSON.stringify(entry)));
	const addedConstraints = head.constraints.filter((entry) => !baseConstraints.has(JSON.stringify(entry)));
	const removedConstraints = base.constraints.filter((entry) => !headConstraints.has(JSON.stringify(entry)));
	const capabilityChanges = diffCapabilities(base.capabilities ?? [], head.capabilities ?? []);
	const baseMcpEndpoint = base.mcpEndpoint ?? null;
	const headMcpEndpoint = head.mcpEndpoint ?? null;
	const mcpEndpointChange = baseMcpEndpoint === headMcpEndpoint ? null : {
		field: "mcpEndpoint",
		from: baseMcpEndpoint,
		to: headMcpEndpoint
	};
	const baseMcpDestructive = base.mcpDestructive === true;
	const headMcpDestructive = head.mcpDestructive === true;
	const mcpDestructiveChange = baseMcpDestructive === headMcpDestructive ? null : {
		field: "mcpDestructive",
		from: baseMcpDestructive,
		to: headMcpDestructive
	};
	const baseMcpAuthenticated = base.mcpAuthenticated ?? false;
	const headMcpAuthenticated = head.mcpAuthenticated ?? false;
	const mcpAuthenticationChange = headMcpEndpoint !== null && baseMcpAuthenticated !== headMcpAuthenticated ? {
		field: "mcpAuthenticated",
		from: baseMcpAuthenticated,
		to: headMcpAuthenticated
	} : null;
	const mcpAuthChanges = baseMcpAuthenticated && headMcpAuthenticated && base.mcpAuth !== null && base.mcpAuth !== void 0 && head.mcpAuth !== null && head.mcpAuth !== void 0 ? collectFieldChanges(base.mcpAuth, head.mcpAuth, [
		"resource",
		"authorizationServers",
		"requiredScopes",
		"scopesSupported",
		"verify"
	]) : [];
	const identical = routeDiff.added.length === 0 && routeDiff.removed.length === 0 && routeDiff.changed.length === 0 && apiDiff.added.length === 0 && apiDiff.removed.length === 0 && apiDiff.changed.length === 0 && addedConstraints.length === 0 && removedConstraints.length === 0 && mcpEndpointChange === null && mcpDestructiveChange === null && mcpAuthenticationChange === null && mcpAuthChanges.length === 0 && capabilityChanges.length === 0;
	return {
		addedApi: apiDiff.added,
		addedConstraints,
		addedRoutes: routeDiff.added,
		capabilityChanges,
		changedApi: apiDiff.changed,
		changedRoutes: routeDiff.changed,
		identical,
		mcpDestructiveChange,
		mcpAuthenticationChange,
		mcpAuthChanges,
		mcpEndpointChange,
		removedApi: apiDiff.removed,
		removedConstraints,
		removedRoutes: routeDiff.removed,
		widensAgentSurface: capabilityChanges.some((change) => change.severity === "warn") || baseMcpEndpoint === null && headMcpEndpoint !== null || !baseMcpDestructive && headMcpDestructive || baseMcpAuthenticated && !headMcpAuthenticated && headMcpEndpoint !== null || mcpAuthChanges.some(mcpAuthChangeWeakensGuard)
	};
}
const AGENT_TRANSPORTS = new Set(["mcp", "webmcp"]);
/**
* Capability changes, classified by whether they widen the agent-reachable
* surface. Registration, exposure, effect class, policy, middleware, and the
* input schema all decide what an agent may do — and all of them are easy to
* change without any visible route diff.
*/
function diffCapabilities(base, head) {
	const baseByName = new Map(base.map((entry) => [entry.name, entry]));
	const headByName = new Map(head.map((entry) => [entry.name, entry]));
	const changes = [];
	for (const entry of head) {
		if (baseByName.has(entry.name)) continue;
		const exposed = entry.transports.length > 0;
		changes.push({
			kind: "added",
			capability: entry.name,
			severity: exposed ? "warn" : "info",
			detail: exposed ? `new ${entry.effect ?? "?"} capability exposed via ${entry.transports.join(", ")}` : `new private ${entry.effect ?? "?"} capability`
		});
	}
	for (const entry of base) {
		if (headByName.has(entry.name)) continue;
		changes.push({
			kind: "removed",
			capability: entry.name,
			severity: "info",
			detail: `removed (was ${entry.transports.join(", ") || "private"})`
		});
	}
	for (const entry of head) {
		const previous = baseByName.get(entry.name);
		if (previous) changes.push(...diffCapability(previous, entry));
	}
	return changes.sort((left, right) => Number(right.severity === "warn") - Number(left.severity === "warn") || left.capability.localeCompare(right.capability));
}
function diffCapability(base, head) {
	const changes = [];
	const capability = head.name;
	const addedTransports = head.transports.filter((transport) => !base.transports.includes(transport));
	const removedTransports = base.transports.filter((transport) => !head.transports.includes(transport));
	if (addedTransports.length > 0) changes.push({
		kind: "exposure-added",
		capability,
		severity: "warn",
		detail: `now exposed via ${addedTransports.join(", ")}${addedTransports.some((transport) => AGENT_TRANSPORTS.has(transport)) ? " — reachable by agents" : ""}`
	});
	if (removedTransports.length > 0) changes.push({
		kind: "exposure-removed",
		capability,
		severity: "info",
		detail: `no longer exposed via ${removedTransports.join(", ")}`
	});
	if (base.effect !== head.effect) changes.push({
		kind: "effect-changed",
		capability,
		severity: base.effect === "destructive" ? "warn" : "info",
		detail: `effect ${base.effect ?? "none"} → ${head.effect ?? "none"}`
	});
	const guardsUnverified = Boolean(base.unverifiedContract || head.unverifiedContract);
	const basePolicy = base.agentPolicy ?? null;
	const headPolicy = head.agentPolicy ?? null;
	if (!guardsUnverified && basePolicy !== headPolicy) {
		const weakened = basePolicy === "require" && headPolicy !== "require";
		changes.push({
			kind: weakened ? "policy-weakened" : "policy-strengthened",
			capability,
			severity: weakened ? "warn" : "info",
			detail: `agentPolicy ${basePolicy ?? "(app default)"} → ${headPolicy ?? "(app default)"}`
		});
	}
	const droppedMiddleware = base.middleware.filter((name) => !head.middleware.includes(name));
	const addedMiddleware = head.middleware.filter((name) => !base.middleware.includes(name));
	if (!guardsUnverified && droppedMiddleware.length > 0) changes.push({
		kind: "middleware-removed",
		capability,
		severity: "warn",
		detail: `middleware removed: ${droppedMiddleware.join(", ")}`
	});
	if (!guardsUnverified && addedMiddleware.length > 0) changes.push({
		kind: "middleware-added",
		capability,
		severity: "info",
		detail: `middleware added: ${addedMiddleware.join(", ")}`
	});
	if (base.httpPath && head.httpPath && base.httpPath !== head.httpPath) changes.push({
		kind: "path-changed",
		capability,
		severity: "info",
		detail: `HTTP path ${base.httpPath} → ${head.httpPath}`
	});
	for (const detail of schemaWidenings(base.input, head.input)) changes.push({
		kind: "input-widened",
		capability,
		severity: "warn",
		detail
	});
	if (JSON.stringify(base.output) !== JSON.stringify(head.output)) changes.push({
		kind: "output-changed",
		capability,
		severity: "info",
		detail: "output schema changed — check what agents can now read"
	});
	if (guardsUnverified && changes.length > 0) changes.push({
		kind: "contract-unverified",
		capability,
		severity: "info",
		detail: "agentPolicy and middleware could not be read statically (the module does not load outside its deploy runtime), so changes to them are not reflected above — review by hand"
	});
	return changes;
}
/**
* Structural widenings of an input schema. Accepting more than before is the
* schema equivalent of loosening a guard, and it disappears into a line diff
* as soon as a schema is more than a few lines long.
*/
function schemaWidenings(base, head, path = "") {
	if (!base || !head) return [];
	const label = path || "input";
	const reasons = [];
	const noLongerRequired = stringArray(base.required).filter((key) => !stringArray(head.required).includes(key));
	if (noLongerRequired.length > 0) reasons.push(`${label}: no longer requires ${noLongerRequired.join(", ")}`);
	if (base.additionalProperties === false && head.additionalProperties !== false) reasons.push(`${label}: additionalProperties opened up`);
	const baseEnum = stringArray(base.enum);
	if (baseEnum.length > 0 && stringArray(head.enum).some((value) => !baseEnum.includes(value))) reasons.push(`${label}: enum widened`);
	for (const keyword of ["maximum", "maxLength"]) {
		const before = base[keyword];
		const after = head[keyword];
		if (typeof before === "number" && (after === void 0 || typeof after === "number" && after > before)) reasons.push(`${label}: ${keyword} raised (${before} → ${after ?? "unbounded"})`);
	}
	for (const keyword of ["minimum", "minLength"]) {
		const before = base[keyword];
		const after = head[keyword];
		if (typeof before === "number" && (after === void 0 || typeof after === "number" && after < before)) reasons.push(`${label}: ${keyword} lowered (${before} → ${after ?? "unbounded"})`);
	}
	const baseProperties = asRecord(base.properties);
	for (const [key, headSchema] of Object.entries(asRecord(head.properties))) {
		const baseSchema = baseProperties[key];
		if (baseSchema) reasons.push(...schemaWidenings(asRecord(baseSchema), asRecord(headSchema), `${label}.${key}`));
	}
	return reasons;
}
function stringArray(value) {
	return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
function mcpAuthChangeWeakensGuard(change) {
	const before = stringArray(change.from);
	const after = stringArray(change.to);
	if (change.field === "requiredScopes") return before.some((scope) => !after.includes(scope));
	if (change.field === "authorizationServers") return after.some((issuer) => !before.includes(issuer));
	return false;
}
function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function diffByPath(base, head, compare) {
	const baseByPath = new Map(base.map((entry) => [entry.path, entry]));
	const headByPath = new Map(head.map((entry) => [entry.path, entry]));
	const added = head.filter((entry) => !baseByPath.has(entry.path));
	const removed = base.filter((entry) => !headByPath.has(entry.path));
	const changed = [];
	for (const entry of head) {
		const baseEntry = baseByPath.get(entry.path);
		if (!baseEntry) continue;
		const changes = compare(baseEntry, entry);
		if (changes.length > 0) changed.push({
			path: entry.path,
			changes
		});
	}
	return {
		added,
		changed,
		removed
	};
}
function collectFieldChanges(base, head, fields) {
	const changes = [];
	for (const field of fields) {
		const from = base[field] ?? null;
		const to = head[field] ?? null;
		if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({
			field,
			from,
			to
		});
	}
	return changes;
}
/** Per-route gzip sizes from the last `pracht build`, when budgets are configured. */
function readRouteBudgets(root) {
	const budgets = /* @__PURE__ */ new Map();
	const reportPath = resolve(root, "dist/server/budget-report.json");
	if (!existsSync(reportPath)) return budgets;
	try {
		const report = JSON.parse(readFileSync(reportPath, "utf-8"));
		for (const result of report.results ?? []) budgets.set(result.path, {
			gzipBytes: result.gzipBytes,
			limitBytes: result.limitBytes,
			ok: result.ok
		});
	} catch {}
	return budgets;
}
function formatPlanLines(diff, options) {
	const budgets = options.budgets ?? /* @__PURE__ */ new Map();
	const lines = [];
	for (const route of diff.addedRoutes) lines.push(`+ route ${route.path}  ${describeRoute(route)}${budgetSuffix(budgets, route.path)}`);
	for (const entry of diff.changedRoutes) lines.push(`~ route ${entry.path}  ${entry.changes.map(formatFieldChange).join(", ")}${budgetSuffix(budgets, entry.path)}`);
	for (const route of diff.removedRoutes) lines.push(`- route ${route.path}`);
	for (const api of diff.addedApi) lines.push(`+ api   ${api.path}  methods=[${api.methods.join(", ")}]`);
	for (const entry of diff.changedApi) lines.push(`~ api   ${entry.path}  ${entry.changes.map(formatFieldChange).join(", ")}`);
	for (const api of diff.removedApi) lines.push(`- api   ${api.path}`);
	if (diff.mcpEndpointChange) lines.push(formatMcpEndpointChange(diff.mcpEndpointChange));
	if (diff.mcpDestructiveChange) lines.push(formatMcpDestructiveChange(diff.mcpDestructiveChange));
	if (diff.mcpAuthenticationChange) lines.push(formatMcpAuthenticationChange(diff.mcpAuthenticationChange));
	for (const change of diff.mcpAuthChanges) lines.push(`${mcpAuthChangeWeakensGuard(change) ? "!" : "~"} mcp oauth ${formatFieldChange(change)}`);
	for (const change of diff.capabilityChanges) lines.push(`${capabilityChangeMarker(change)} capability ${change.capability}  ${change.detail}`);
	for (const constraint of diff.addedConstraints) lines.push(`+ constraint ${describeConstraint(constraint)}`);
	for (const constraint of diff.removedConstraints) lines.push(`- constraint ${describeConstraint(constraint)}`);
	return lines;
}
/**
* Diff-block prefix. `!` marks a widening so it reads as a warning in the
* rendered diff rather than blending into ordinary additions.
*/
function capabilityChangeMarker(change) {
	if (change.severity === "warn") return "!";
	if (change.kind === "added") return "+";
	if (change.kind === "removed") return "-";
	return "~";
}
function formatMcpEndpointChange(change) {
	const from = typeof change.from === "string" ? change.from : null;
	const to = typeof change.to === "string" ? change.to : null;
	if (!from && to) return `! mcp endpoint ${to} enabled — declared MCP capabilities are now reachable by agents`;
	if (from && !to) return `- mcp endpoint ${from} disabled`;
	return `~ mcp endpoint ${from} → ${to}`;
}
function formatMcpDestructiveChange(change) {
	return change.to === true ? "! mcp destructive tools enabled — declared destructive MCP capabilities are now reachable by agents" : "- mcp destructive tools disabled";
}
function formatMcpAuthenticationChange(change) {
	return change.to === true ? "+ mcp oauth protection enabled" : "! mcp oauth protection disabled — remote MCP endpoint no longer requires bearer tokens";
}
function formatPlanText(diff, options) {
	const header = options.base ? `Pracht plan (base: ${options.base})` : "Pracht plan (no baseline snapshot — every entry shows as added)";
	const lines = formatPlanLines(diff, options);
	if (diff.identical) return `${header}\n\nNo app graph changes.`;
	const footer = diff.widensAgentSurface ? "\n\nThis change widens what agents can reach or weakens a guard (! lines)." : "";
	return `${header}\n\n${lines.join("\n")}${footer}`;
}
function formatPlanMarkdown(diff, options) {
	const heading = options.base ? `### App graph changes (base: \`${options.base}\`)` : "### App graph (no baseline snapshot at the base ref)";
	if (diff.identical) return `${heading}\n\nNo app graph changes.`;
	const lines = formatPlanLines(diff, options);
	const summary = [
		countLabel(diff.addedRoutes.length + diff.addedApi.length, "added"),
		countLabel(diff.changedRoutes.length + diff.changedApi.length, "changed"),
		countLabel(diff.removedRoutes.length + diff.removedApi.length, "removed"),
		countLabel(diff.mcpEndpointChange ? 1 : 0, "MCP endpoint change"),
		countLabel(diff.mcpDestructiveChange ? 1 : 0, "MCP destructive-mode change"),
		countLabel(diff.mcpAuthenticationChange ? 1 : 0, "MCP authentication change"),
		countLabel(diff.mcpAuthChanges.length, "MCP OAuth policy change"),
		countLabel(diff.capabilityChanges.length, "capability change")
	].filter(Boolean).join(", ");
	const warning = diff.widensAgentSurface ? "> ⚠️ **This change widens what agents can reach or weakens a guard.**" : "";
	return [
		heading,
		"",
		summary ? `${summary}.` : "",
		warning,
		"```diff",
		...lines,
		"```"
	].filter((line, index) => line !== "" || index === 1).join("\n");
}
function describeRoute(route) {
	const parts = [`render=${route.render ?? "default"}`];
	if (route.hydration) parts.push(`hydration=${route.hydration}`);
	if (route.streaming) parts.push("streaming=true");
	parts.push(`shell=${route.shell ?? "none"}`);
	parts.push(`middleware=[${route.middleware.join(", ")}]`);
	if (route.markdown) parts.push("markdown=true");
	if (route.loaderFile) parts.push(`loader=${route.loaderFile}`);
	if (route.revalidate) parts.push(`revalidate=${JSON.stringify(route.revalidate)}`);
	return parts.join("  ");
}
function describeConstraint(constraint) {
	const { kind, pattern, ...rest } = constraint;
	const detail = Object.entries(rest).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
	return `${kind} ${pattern}${detail ? `  ${detail}` : ""}`;
}
function formatFieldChange(change) {
	return `${change.field}: ${formatValue(change.from)} → ${formatValue(change.to)}`;
}
function formatValue(value) {
	if (value === null || value === void 0) return "none";
	if (Array.isArray(value)) return `[${value.map((entry) => String(entry)).join(", ")}]`;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}
function budgetSuffix(budgets, path) {
	const budget = budgets.get(path);
	if (!budget) return "";
	const status = budget.ok ? "" : " ⚠ over budget";
	return `  (${formatBytes(budget.gzipBytes)} gz / ${formatBytes(budget.limitBytes)} limit${status})`;
}
function countLabel(count, label) {
	return count > 0 ? `${count} ${label}` : "";
}
//#endregion
export { readGraphSnapshotFromDisk as a, resolveLiveGraph as c, serializeMcpAuth as d, writeGraphSnapshot as f, collectCapabilityAppGraph as g, collectAppGraph as h, formatPlanText as i, resolveLiveGraphMetadata as l, withAppServer as m, diffGraphSnapshots as n, readRouteBudgets as o, resolveBuildLlmsTxtEnabled as p, formatPlanMarkdown as r, resolveBaseSnapshot as s, GRAPH_SNAPSHOT_PATH as t, serializeGraphSnapshot as u };
