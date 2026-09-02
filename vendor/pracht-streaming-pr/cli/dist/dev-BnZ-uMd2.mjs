import { h as collectAppGraph } from "./graph-snapshot-C3nG4UBK.mjs";
import { a as readProjectConfig, c as resolveProjectPath, v as requirePositiveInteger } from "./project-C-2I9C0N.mjs";
import { a as isRouteSource, o as isWithinDirectory } from "./verification-helpers-D_Az_Kqg.mjs";
import { i as runTypegen, n as DEFAULT_DECLARATION_OUT, r as DEFAULT_RUNTIME_OUT, t as DEFAULT_CAPABILITIES_OUT } from "./typegen-q813DPhU.mjs";
import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer, loadEnv } from "vite";
//#region src/dotenv.ts
/**
* Load `.env` files into `process.env` for the local dev server.
*
* Vite reads `.env` files, but only exposes prefixed keys through
* `import.meta.env` — it never writes them to `process.env`. Server-side code
* reads `process.env` (that is what `serverEnv` resolves to on Node and
* Vercel), so an unprefixed secret in `.env` was simply invisible: a
* `PRACHT_CONFIRMATION_SECRET` sitting in the file the user just created had no
* effect, and the destructive-capability gate failed closed with
* `confirmation_unavailable`.
*
* Wrangler already does this for Cloudflare apps ("Using secrets defined in
* .env"), so the same project behaved differently per adapter.
*
* Real environment variables always win over the file, matching Vite, wrangler,
* and dotenv. `.env.<mode>.local` beats `.env.<mode>`, which beats
* `.env.local`, which beats `.env`; `loadEnv`
* already implements.
*
* `mode` is required rather than derived from `NODE_ENV`: Vite's dev server is
* always mode `development` whatever `NODE_ENV` says, and guessing wrong would
* load `.env.production` into a dev server.
*/
function loadDotEnvIntoProcess(root, mode) {
	const fileEnv = loadEnv(mode, root, "");
	const applied = [];
	for (const [key, value] of Object.entries(fileEnv)) {
		if (key === "NODE_ENV") continue;
		if (key in process.env) continue;
		process.env[key] = value;
		applied.push(key);
	}
	return applied;
}
//#endregion
//#region src/dev-banner.ts
const ANSI = {
	bold: "1",
	cyan: "36",
	dim: "2",
	green: "32",
	magenta: "35",
	red: "31",
	yellow: "33"
};
const MODE_COLORS = {
	isg: ANSI.cyan,
	spa: ANSI.magenta,
	ssg: ANSI.green,
	ssr: ANSI.yellow
};
const EFFECT_COLORS = {
	destructive: ANSI.red,
	read: ANSI.green,
	write: ANSI.yellow
};
/**
* Format the `pracht dev` startup banner: local URL(s) plus an aligned table
* of page routes (pattern, render mode, shell, middleware) and API routes.
*/
function formatDevBanner(options) {
	const { apiRoutes, capabilities = [], color = false, localUrls, mcpDestructive = false, mcpAuthenticated = false, mcpEndpoint = null, mcpRuntimeStatus: configuredMcpRuntimeStatus, mcpUnavailableReasons = [], networkUrls = [], notFound, routes } = options;
	const mcpRuntimeStatus = configuredMcpRuntimeStatus ?? (mcpEndpoint === null ? "not-configured" : mcpUnavailableReasons.length > 0 ? "blocked" : "ready");
	const paint = (text, code) => color ? `\u001b[${code}m${text}\u001b[0m` : text;
	const lines = [];
	lines.push("");
	lines.push(`  ${paint("pracht dev", ANSI.bold)}`);
	lines.push("");
	for (const url of localUrls) lines.push(`  ${paint("➜", ANSI.green)}  Local:   ${paint(url, `${ANSI.bold};${ANSI.cyan}`)}`);
	for (const url of networkUrls) lines.push(`  ${paint("➜", ANSI.green)}  Network: ${paint(url, ANSI.cyan)}`);
	lines.push("");
	lines.push(`  ${paint(`Routes (${routes.length})`, ANSI.bold)}`);
	if (routes.length === 0 && !notFound) lines.push("    (none)");
	else {
		const allRoutes = [...routes, ...notFound ? [notFound] : []];
		const showHydration = allRoutes.some((route) => route.hydration && route.hydration !== "full");
		const rows = allRoutes.map((route) => [
			route.path,
			route.render ?? "ssr",
			...showHydration ? [route.hydration ?? "full"] : [],
			route.shell ?? "-",
			route.middleware.length > 0 ? route.middleware.join(", ") : "-"
		]);
		const header = [
			"ROUTE",
			"MODE",
			...showHydration ? ["HYDRATION"] : [],
			"SHELL",
			"MIDDLEWARE"
		];
		const widths = columnWidths([header, ...rows]);
		lines.push(`    ${paint(formatRow(header, widths), ANSI.dim)}`);
		for (const row of rows) {
			const cells = row.map((cell, index) => {
				const padded = index === row.length - 1 ? cell : cell.padEnd(widths[index]);
				return index === 1 ? paint(padded, MODE_COLORS[cell] ?? ANSI.dim) : padded;
			});
			lines.push(`    ${cells.join("  ")}`.trimEnd());
		}
	}
	lines.push("");
	lines.push(`  ${paint(`API (${apiRoutes.length})`, ANSI.bold)}`);
	if (apiRoutes.length === 0) lines.push("    (none)");
	else {
		const rows = apiRoutes.map((route) => [route.path, route.methods.length > 0 ? route.methods.join(", ") : "-"]);
		const header = ["ROUTE", "METHODS"];
		const widths = columnWidths([header, ...rows]);
		lines.push(`    ${paint(formatRow(header, widths), ANSI.dim)}`);
		for (const row of rows) lines.push(`    ${formatRow(row, widths)}`);
	}
	lines.push("");
	if (capabilities.length > 0 || mcpEndpoint) {
		const heading = `Capabilities (${capabilities.length})`;
		lines.push(mcpEndpoint ? `  ${paint(heading, ANSI.bold)}  ${paint(`MCP endpoint ${mcpEndpoint}${mcpAuthenticated ? " (oauth)" : ""}`, ANSI.dim)}` : `  ${paint(heading, ANSI.bold)}`);
		if (capabilities.length === 0) lines.push("    (none)");
		else {
			const unreadable = capabilities.filter((capability) => capability.error);
			const rows = capabilities.map((capability) => [
				capability.name,
				capability.effect ?? "?",
				capability.transports.length > 0 ? capability.transports.map((transport) => transport !== "mcp" ? transport : !mcpEndpoint || capability.effect === "destructive" && !mcpDestructive || mcpRuntimeStatus === "blocked" ? "mcp(unserved)" : mcpRuntimeStatus === "unverified" ? "mcp(unverified)" : transport).join(",") : "private",
				capability.httpPath ?? "-"
			]);
			const header = [
				"NAME",
				"EFFECT",
				"EXPOSURE",
				"HTTP"
			];
			const widths = columnWidths([header, ...rows]);
			lines.push(`    ${paint(formatRow(header, widths), ANSI.dim)}`);
			for (const row of rows) {
				const [name, effect, exposure, httpPath] = row;
				const cells = [
					name.padEnd(widths[0]),
					paint(effect.padEnd(widths[1]), EFFECT_COLORS[effect] ?? ANSI.dim),
					exposure.padEnd(widths[2]),
					httpPath
				];
				lines.push(`    ${cells.join("  ")}`.trimEnd());
			}
			for (const capability of unreadable) lines.push(`    ${paint(`! ${capability.name} could not be loaded: ${capability.error}`, ANSI.red)}`);
			if (mcpUnavailableReasons.length > 0) lines.push(`    ${paint(mcpRuntimeStatus === "unverified" ? `! MCP endpoint unverified: ${mcpUnavailableReasons.join(" ")} Registrations in the adapter server entry are not evaluated by graph-only inspection.` : `! MCP endpoint unavailable: ${mcpUnavailableReasons.join(" ")}`, mcpRuntimeStatus === "unverified" ? ANSI.yellow : ANSI.red)}`);
			if (unreadable.length > 0) lines.push(`    ${paint("  Effect, exposure, policy and middleware above were recovered from the source; output schemas are unavailable, so `pracht typegen` types them as `unknown`. If the module imports `@pracht/capabilities`, install it.", ANSI.dim)}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}
/** Respect NO_COLOR (https://no-color.org) and only color TTY output. */
function supportsColor(env = process.env, isTTY = Boolean(process.stdout.isTTY)) {
	if (env.NO_COLOR) return false;
	if (env.FORCE_COLOR) return true;
	return isTTY;
}
function columnWidths(rows) {
	const widths = [];
	for (const row of rows) row.forEach((cell, index) => {
		widths[index] = Math.max(widths[index] ?? 0, cell.length);
	});
	return widths;
}
function formatRow(cells, widths) {
	return cells.map((cell, index) => index === cells.length - 1 ? cell : cell.padEnd(widths[index])).join("  ").trimEnd();
}
//#endregion
//#region src/commands/dev.ts
var dev_default = defineCommand({
	meta: {
		name: "dev",
		description: "Start development server with HMR"
	},
	args: {
		cacheDir: {
			type: "string",
			description: "Vite cache directory (defaults to node_modules/.vite)"
		},
		port: {
			type: "string",
			description: "Port number (defaults to $PORT or 3000)"
		}
	},
	async run({ args }) {
		const root = process.cwd();
		loadDotEnvIntoProcess(root, "development");
		const positionalPort = args._?.[0] != null ? String(args._[0]) : void 0;
		const port = requirePositiveInteger(args.port ?? positionalPort ?? process.env.PORT, "port", 3e3);
		const server = await createServer({
			cacheDir: args.cacheDir,
			root,
			server: { port }
		});
		await server.listen();
		const watchesGeneratedRouteTypes = watchGeneratedRouteTypes(server, root);
		try {
			const graph = await collectAppGraph(server, root, { appFile: readProjectConfig(root).appFile });
			const urls = server.resolvedUrls ?? {
				local: [],
				network: []
			};
			console.log(formatDevBanner({
				apiRoutes: graph.api,
				capabilities: graph.capabilities,
				color: supportsColor(),
				localUrls: urls.local,
				mcpAuthenticated: graph.mcpAuthenticated,
				mcpEndpoint: graph.mcpEndpoint ?? null,
				mcpDestructive: graph.mcpDestructive === true,
				mcpRuntimeStatus: graph.mcpRuntimeStatus,
				mcpUnavailableReasons: graph.mcpUnavailableReasons,
				networkUrls: urls.network,
				notFound: graph.notFound,
				routes: graph.routes
			}));
			if (!watchesGeneratedRouteTypes) console.log("\n  Tip: run `pracht typegen` once to enable typed routes and `apiFetch()`; `pracht dev` will keep them in sync.\n");
		} catch {
			server.printUrls();
		}
	}
});
/**
* Keep generated route types in sync while the dev server runs. Opt-in by
* having run `pracht typegen` once: when the generated declaration exists at
* its default location it is refreshed on startup, whenever files that can
* define routes are added or removed (renames arrive as an unlink + add pair),
* and whenever the app manifest or one of its imported definition modules
* changes. Handler signature changes need no regeneration — the declaration
* references route modules with `typeof import(...)`, so those types update
* live. Projects that never ran typegen are left untouched and receive a
* setup tip in the dev banner.
*/
function watchGeneratedRouteTypes(server, root) {
	const declarationPath = resolve(root, DEFAULT_DECLARATION_OUT);
	if (!existsSync(declarationPath)) return false;
	const generatedPaths = new Set([
		declarationPath,
		resolve(root, DEFAULT_RUNTIME_OUT),
		resolve(root, DEFAULT_CAPABILITIES_OUT)
	]);
	const project = readProjectConfig(root);
	const appFilePath = resolveProjectPath(root, project.appFile);
	const routeSourceDirs = (project.mode === "pages" ? [project.pagesDir] : [project.routesDir, project.shellsDir]).map((directory) => resolveProjectPath(root, directory));
	let queued = null;
	let running = false;
	let rerunQueued = false;
	const regenerate = async () => {
		if (running) {
			rerunQueued = true;
			return;
		}
		running = true;
		try {
			await runTypegen({
				capabilitiesOut: DEFAULT_CAPABILITIES_OUT,
				check: false,
				declarationOut: DEFAULT_DECLARATION_OUT,
				root,
				runtimeOut: DEFAULT_RUNTIME_OUT
			});
		} catch (error) {
			console.warn(`pracht typegen failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			running = false;
			if (rerunQueued) {
				rerunQueued = false;
				regenerate();
			}
		}
	};
	const queueRegenerate = (file, requireRouteExtension = true) => {
		const couldUseUnresolvedExtension = !project.additionalExtensionsIsStatic && routeSourceDirs.some((directory) => isWithinDirectory(file, directory));
		if (!file.startsWith(root) || requireRouteExtension && !isRouteSource(file, project.additionalExtensions) && !couldUseUnresolvedExtension || generatedPaths.has(file)) return;
		if (queued) clearTimeout(queued);
		queued = setTimeout(() => {
			queued = null;
			regenerate();
		}, 300);
	};
	server.watcher.on("add", (file) => queueRegenerate(file));
	server.watcher.on("unlink", (file) => queueRegenerate(file));
	server.watcher.on("change", (file) => {
		if (isAppManifestDependency(server, file, appFilePath)) queueRegenerate(file, false);
	});
	regenerate();
	return true;
}
/** Whether `file` is the app manifest or one of its local imported modules. */
function isAppManifestDependency(server, file, appFilePath) {
	if (file === appFilePath) return true;
	const modules = server.environments.ssr.moduleGraph.getModulesByFile(file);
	if (!modules) return false;
	const pending = [...modules];
	const visited = new Set(pending);
	while (pending.length > 0) {
		const module = pending.pop();
		for (const importer of module.importers) {
			if (importer.file === appFilePath) return true;
			if (!visited.has(importer)) {
				visited.add(importer);
				pending.push(importer);
			}
		}
	}
	return false;
}
//#endregion
export { dev_default as default };
