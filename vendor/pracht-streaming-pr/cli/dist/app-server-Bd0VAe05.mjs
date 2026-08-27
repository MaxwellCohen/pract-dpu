import { a as readProjectConfig, c as resolveProjectPath } from "./project-C-2I9C0N.mjs";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createServer } from "vite";
import { resolveMcpEndpoint, resolveRegistryModule, serializeApiRoutesStatic, serializeCapabilities } from "@pracht/core";
import { PRACHT_GRAPH_ONLY_ENV } from "@pracht/core/server";
import { tmpdir } from "node:os";
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
	return {
		api: await serializeApiRoutesStatic(serverModule.apiRoutes, {
			readSource: (file) => readStaticAppModule(root, file),
			resolveModule: (specifier, importer) => resolveStaticModule(server, root, specifier, importer)
		}),
		capabilities: await serializeCapabilities(serverModule.resolvedApp.capabilities, {
			loadModule: capabilityModuleLoader(server, serverModule),
			readSource: createSourceReader(root, options.appFile ?? "/src/routes.ts")
		}),
		mcpEndpoint: resolveMcpEndpoint(serverModule.resolvedApp.agents),
		notFound: notFound ? serializeResolvedRoutes([notFound])[0] : null,
		routes: serializeResolvedRoutes(serverModule.resolvedApp.routes)
	};
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
export { createSourceReader as i, capabilityModuleLoader as n, collectAppGraph as r, withAppServer as t };
