import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { r as VERSION } from "./index.mjs";
import { t as readClientBuildAssets } from "./build-metadata-QAcUp6lA.mjs";
import { a as formatBytes, i as formatBundleReport, n as evaluateBudgets, o as shouldUseColor, r as formatBudgetResults, t as collectBundleReport } from "./bundle-report-lW_Uk3V5.mjs";
import { register } from "node:module";
import { defineCommand } from "citty";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { OAUTH_PROTECTED_RESOURCE_WELL_KNOWN, matchRoutePath, mcpResourceMetadataPath, resolveMcpEndpoint, routePathIsDynamic } from "@pracht/core";
import { randomBytes } from "node:crypto";
import { buildStaticRouteStateUrl, getTimeRevalidateSeconds } from "@pracht/core/server";
//#region src/build-shared.ts
const ROUTE_STATE_REQUEST_HEADER = "x-pracht-route-state-request";
/**
* Vercel only accepts `.prerender-config.json` (ISR) next to a Serverless
* Function — pairing one with an Edge Function fails the deployment with
* `Unexpected function type "EdgeFunction"`. ISG routes therefore run on Node
* while the main handler stays on the edge; both load the same Web-API-only
* server bundle.
*/
const VERCEL_NODE_RUNTIME = "nodejs22.x";
/**
* Named so it cannot collide with a chunk emitted into `dist/server`. It is
* CommonJS (like Next.js' `___next_launcher.cjs`) so Vercel's Node launcher can
* require it without relying on ES module interop; the ESM server bundle is
* pulled in through a dynamic import.
*/
const VERCEL_NODE_ENTRY_FILE = "_pracht-node-entry.cjs";
const VERCEL_NODE_ENTRY_SOURCE = `let listener;

module.exports = async (req, res) => {
  listener ??= (await import("./server.js")).nodeListener;
  return listener(req, res);
};
`;
/** Runtime-owned agent paths that must win over Vercel's method-agnostic static rewrites. */
function resolveVercelRuntimeRoutes(agents) {
	const endpoint = resolveMcpEndpoint(agents);
	if (endpoint === null) return [];
	const auth = agents?.mcp?.auth;
	return [endpoint, ...auth ? [OAUTH_PROTECTED_RESOURCE_WELL_KNOWN, mcpResourceMetadataPath(auth)] : []];
}
function writeVercelBuildOutput({ base = "/", functionName, headersManifest = {}, isgManifest, markdownRoutes = [], revalidateToken = process.env.PRACHT_REVALIDATE_TOKEN || randomBytes(32).toString("hex"), regions, root, runtimeRoutes = [], staticAssetRoutes = [], staticRoutes }) {
	const deployBase = resolveVercelDeployBase(base);
	const outputDir = join(root, ".vercel/output");
	const staticDeployDir = resolveVercelStaticDeployDir(join(outputDir, "static"), deployBase);
	const functionsDir = join(outputDir, "functions");
	const resolvedFunctionName = functionName || "render";
	const functionDir = join(functionsDir, `${resolvedFunctionName}.func`);
	assertNoVercelPrerenderFunctionCollisions({
		functionDir,
		functionName: resolvedFunctionName,
		functionsDir,
		isgRoutes: Object.keys(isgManifest).map((route) => withVercelDeployBase(route, deployBase))
	});
	rmSync(outputDir, {
		force: true,
		recursive: true
	});
	mkdirSync(outputDir, { recursive: true });
	mkdirSync(staticDeployDir, { recursive: true });
	cpSync(join(root, "dist/client"), staticDeployDir, { recursive: true });
	cpSync(join(root, "dist/server"), functionDir, { recursive: true });
	writeFileSync(join(functionDir, ".vc-config.json"), `${JSON.stringify(createVercelFunctionConfig({ regions }), null, 2)}\n`, "utf-8");
	writeVercelPrerenderFunctions({
		functionDir,
		functionsDir,
		headersManifest,
		isgManifest,
		regions,
		revalidateToken,
		staticDir: staticDeployDir,
		deployBase
	});
	writeFileSync(join(outputDir, "config.json"), `${JSON.stringify(createVercelOutputConfig({
		functionName,
		headersManifest,
		markdownRoutes,
		runtimeRoutes,
		staticAssetRoutes,
		staticRoutes,
		isgRoutes: Object.keys(isgManifest),
		deployBase
	}), null, 2)}\n`, "utf-8");
	return ".vercel/output";
}
function assertNoVercelPrerenderFunctionCollisions({ functionDir, functionName, functionsDir, isgRoutes }) {
	for (const route of isgRoutes) {
		const prerenderName = routeToPrerenderFunctionName(route);
		if (join(functionsDir, `${prerenderName}.func`) !== functionDir) continue;
		throw new Error(`Cannot emit Vercel ISG route ${JSON.stringify(route)} because its prerender function ${JSON.stringify(`${prerenderName}.func`)} collides with the main edge function ${JSON.stringify(`${functionName}.func`)}. Rename the route or configure vercelAdapter({ functionName: "..." }) with a non-conflicting name.`);
	}
}
function writeVercelPrerenderFunctions({ deployBase, functionDir, functionsDir, headersManifest, isgManifest, regions, revalidateToken, staticDir }) {
	let sharedNodeFunctionDir;
	for (const [route, entry] of Object.entries(isgManifest)) {
		const prerenderName = routeToPrerenderFunctionName(withVercelDeployBase(route, deployBase));
		const routeFunctionDir = join(functionsDir, `${prerenderName}.func`);
		if (sharedNodeFunctionDir) linkVercelPrerenderFunction({
			routeFunctionDir,
			sharedNodeFunctionDir
		});
		else {
			writeVercelPrerenderFunction({
				functionDir,
				regions,
				routeFunctionDir
			});
			sharedNodeFunctionDir = routeFunctionDir;
		}
		const configPath = join(functionsDir, `${prerenderName}.prerender-config.json`);
		const fallbackName = `${basename$1(prerenderName)}.prerender-fallback.html`;
		const fallbackPath = join(dirname(configPath), fallbackName);
		const staticHtmlPath = join(staticDir, routeToStaticHtmlPath(route).slice(1));
		if (existsSync(staticHtmlPath)) {
			mkdirSync(dirname(fallbackPath), { recursive: true });
			cpSync(staticHtmlPath, fallbackPath);
			rmSync(staticHtmlPath, { force: true });
		}
		writeFileSync(configPath, `${JSON.stringify({
			allowQuery: [],
			bypassToken: revalidateToken,
			expiration: getTimeRevalidateSeconds(entry.revalidate) ?? false,
			fallback: existsSync(fallbackPath) ? fallbackName : void 0,
			initialHeaders: headersManifest[route],
			initialStatus: 200
		}, null, 2)}\n`, "utf-8");
	}
}
/**
* Emit the Serverless Function ISG routes render through. It gets its own copy
* of the server bundle rather than linking to the edge function's: Node
* resolves a symlinked module at its real path, so a linked `server.js` would
* be typed by the edge function directory — which carries no ESM
* `package.json` — and fail to parse as CommonJS.
*/
function writeVercelPrerenderFunction({ functionDir, regions, routeFunctionDir }) {
	mkdirSync(dirname(routeFunctionDir), { recursive: true });
	cpSync(functionDir, routeFunctionDir, { recursive: true });
	writeFileSync(join(routeFunctionDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf-8");
	writeFileSync(join(routeFunctionDir, VERCEL_NODE_ENTRY_FILE), VERCEL_NODE_ENTRY_SOURCE, "utf-8");
	writeFileSync(join(routeFunctionDir, ".vc-config.json"), `${JSON.stringify(createVercelNodeFunctionConfig({ regions }), null, 2)}\n`, "utf-8");
}
function linkVercelPrerenderFunction({ routeFunctionDir, sharedNodeFunctionDir }) {
	mkdirSync(dirname(routeFunctionDir), { recursive: true });
	try {
		symlinkSync(relative(dirname(routeFunctionDir), sharedNodeFunctionDir), routeFunctionDir, "dir");
	} catch {
		cpSync(sharedNodeFunctionDir, routeFunctionDir, { recursive: true });
	}
}
const ACCEPT_MARKDOWN_PATTERN = ".*[tT][eE][xX][tT]/[mM][aA][rR][kK][dD][oO][wW][nN].*";
function createVercelOutputConfig({ deployBase, functionName, headersManifest, markdownRoutes, runtimeRoutes, staticAssetRoutes, staticRoutes, isgRoutes }) {
	const target = `/${functionName || "render"}`;
	const routes = [
		{
			continue: true,
			headers: {
				"permissions-policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
				"referrer-policy": "strict-origin-when-cross-origin",
				"x-content-type-options": "nosniff",
				"x-frame-options": "SAMEORIGIN"
			},
			src: "^/(.*)$"
		},
		{
			dest: target,
			has: [{
				type: "header",
				key: ROUTE_STATE_REQUEST_HEADER,
				value: "1"
			}],
			src: "/(.*)"
		},
		{
			dest: target,
			has: [{
				type: "query",
				key: "_data",
				value: "1"
			}],
			src: "/(.*)"
		}
	];
	if (deployBase !== "/") routes.push({
		dest: target,
		methods: ["GET", "HEAD"],
		src: `^${escapeRegex(deployBase.slice(0, -1))}$`
	});
	const publicRuntimeRoutes = deployBase === "/" ? runtimeRoutes : [...runtimeRoutes, ...runtimeRoutes.map((route) => withVercelDeployBase(route, deployBase))];
	for (const route of sortStaticRoutes(publicRuntimeRoutes)) routes.push({
		dest: target,
		src: routeToRouteExpression(route)
	});
	const staticAssetRouteSet = new Set(staticAssetRoutes);
	for (const route of sortStaticRoutes([...staticRoutes, ...staticAssetRoutes])) {
		const routeHeaders = headersManifest[route];
		if (!routeHeaders) continue;
		const publicRoute = withVercelDeployBase(route, deployBase);
		routes.push({
			continue: true,
			headers: routeHeaders,
			src: staticAssetRouteSet.has(route) ? routeToStaticAssetExpression(publicRoute) : routeToRouteExpression(publicRoute)
		});
	}
	const markdownRouteSet = new Set(markdownRoutes);
	const markdownRouteEntry = (route) => ({
		dest: target,
		has: [{
			type: "header",
			key: "accept",
			value: ACCEPT_MARKDOWN_PATTERN
		}],
		src: routeToRouteExpression(withVercelDeployBase(route, deployBase))
	});
	for (const route of sortStaticRoutes(staticRoutes)) {
		if (markdownRouteSet.has(route)) routes.push(markdownRouteEntry(route));
		routes.push({
			dest: withVercelDeployBase(routeToStaticHtmlPath(route), deployBase),
			src: routeToRouteExpression(withVercelDeployBase(route, deployBase))
		});
	}
	for (const route of isgRoutes) {
		if (markdownRouteSet.has(route)) routes.push(markdownRouteEntry(route));
		const publicRoute = withVercelDeployBase(route, deployBase);
		routes.push({
			dest: publicRoute,
			src: routeToRouteExpression(publicRoute)
		});
	}
	routes.push({ handle: "filesystem" });
	routes.push({
		dest: target,
		src: "/(.*)"
	});
	return {
		framework: { version: VERSION },
		routes,
		version: 3
	};
}
function createVercelFunctionConfig({ regions }) {
	const config = {
		entrypoint: "server.js",
		runtime: "edge"
	};
	if (regions) config.regions = regions;
	return config;
}
function createVercelNodeFunctionConfig({ regions }) {
	const config = {
		handler: VERCEL_NODE_ENTRY_FILE,
		launcherType: "Nodejs",
		runtime: VERCEL_NODE_RUNTIME,
		shouldAddHelpers: false
	};
	if (regions && regions !== "all") config.regions = Array.isArray(regions) ? regions : [regions];
	return config;
}
function sortStaticRoutes(routes) {
	return [...new Set(routes)].sort((left, right) => right.length - left.length);
}
/** Vite path bases address routes; CDN/document-relative bases do not. */
function resolveVercelDeployBase(base) {
	if (!base.startsWith("/") || base.startsWith("//")) return "/";
	if (base === "/") return base;
	const normalized = base.endsWith("/") ? base : `${base}/`;
	if (normalized.slice(1, -1).split("/").some((segment) => segment === "")) throw new Error(`Vercel deploy base contains a repeated path separator: ${JSON.stringify(base)}.`);
	return normalized;
}
function withVercelDeployBase(pathname, base) {
	if (base === "/") return pathname;
	const prefix = base.slice(0, -1);
	return pathname === "/" ? prefix : `${prefix}${pathname}`;
}
function resolveVercelStaticDeployDir(staticDir, base) {
	if (base === "/") return staticDir;
	return join(staticDir, ...base.slice(1, -1).split("/").map((segment) => {
		let decoded;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			throw new Error(`Vercel deploy base contains invalid percent-encoding: ${JSON.stringify(base)}.`);
		}
		if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || [...decoded].some((character) => {
			const codePoint = character.codePointAt(0);
			return codePoint === 0 || codePoint !== void 0 && (codePoint <= 31 || codePoint === 127);
		})) throw new Error(`Vercel deploy base contains an unsafe path segment: ${JSON.stringify(base)}.`);
		return decoded;
	}));
}
function routeToRouteExpression(route) {
	if (route === "/") return "^/$";
	return `^${escapeRegex(route)}/?$`;
}
function routeToStaticHtmlPath(route) {
	if (route === "/") return "/index.html";
	return `${route}/index.html`;
}
function routeToPrerenderFunctionName(route) {
	return route === "/" ? "index" : route.replace(/^\/+/, "");
}
function basename$1(value) {
	const segments = value.split("/");
	return segments[segments.length - 1] || "index";
}
function routeToStaticAssetExpression(route) {
	return `^${escapeRegex(route)}$`;
}
function escapeRegex(value) {
	return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}
//#endregion
//#region src/build-static.ts
function isStaticExportBuild(serverMod) {
	return serverMod.staticTarget === true;
}
const SERVERFUL_ADAPTERS = "use @pracht/adapter-node, @pracht/adapter-cloudflare, or @pracht/adapter-vercel instead";
/** For problems about API routes and capabilities, where render modes do not apply. */
const SERVERFUL_ADAPTER_HINT = `${SERVERFUL_ADAPTERS}.`;
/** For problems about routes, which have the additional per-route escape hatch. */
const SERVERFUL_ROUTE_HINT = `${SERVERFUL_ADAPTERS}, or change the route to render: "ssg" (or loaderless "spa" for client-only pages).`;
function normalizeModulePath(path) {
	return path.replace(/^\.?\//, "");
}
function resolveRegistryImporter(modules, file) {
	if (file in modules) return modules[file];
	const normalizedFile = normalizeModulePath(file);
	for (const [registeredFile, importer] of Object.entries(modules)) {
		const normalizedRegisteredFile = normalizeModulePath(registeredFile);
		if (normalizedRegisteredFile === normalizedFile || normalizedRegisteredFile.endsWith(`/${normalizedFile}`)) return importer;
	}
}
function formatUnknownError(error) {
	return error instanceof Error ? error.message : String(error);
}
function portableOutputName(name) {
	return name.normalize("NFC").toLowerCase();
}
function isSafeStaticDeployBase(base) {
	if (!base.startsWith("/") || base.startsWith("//") || base.includes("?") || base.includes("#")) return false;
	try {
		const segments = base.split("/");
		return segments.every((segment, index) => {
			if (segment === "" && index !== 0 && index !== segments.length - 1) return false;
			const decoded = decodeURIComponent(segment);
			if (decoded === "." || decoded === "..") return false;
			for (const character of decoded) {
				const codePoint = character.codePointAt(0);
				if (character === "/" || character === "\\" || codePoint === 0 || codePoint !== void 0 && (codePoint <= 31 || codePoint === 127)) return false;
			}
			return true;
		});
	} catch {
		return false;
	}
}
/**
* Find an existing output whose path is equivalent on portable,
* case-insensitive filesystems. Walk one component at a time so a file that
* occupies a generated directory prefix is reported as a conflict too.
*/
function findPortableOutputConflict(root, filePath) {
	const targetParts = relative(root, filePath).split(sep);
	const existingParts = [];
	let currentDir = root;
	for (let index = 0; index < targetParts.length; index += 1) {
		let entries;
		try {
			entries = readdirSync(currentDir, { withFileTypes: true });
		} catch {
			return existingParts.length > 0 ? existingParts.join("/") : null;
		}
		const targetName = portableOutputName(targetParts[index]);
		const existing = entries.find((entry) => portableOutputName(entry.name) === targetName);
		if (!existing) return null;
		existingParts.push(existing.name);
		if (index === targetParts.length - 1 || !existing.isDirectory()) return existingParts.join("/");
		currentDir = resolve(currentDir, existing.name);
	}
	return null;
}
/**
* Throw a single aggregated error when the app needs a server at runtime.
* Called before prerendering so a doomed static build fails fast, with every
* problem listed at once.
*/
async function validateStaticExport(serverMod) {
	const problems = [];
	const routes = serverMod.resolvedApp?.routes ?? [];
	const notFound = serverMod.resolvedApp?.notFound;
	const pageRoutes = notFound ? [...routes, notFound] : routes;
	const buildBase = serverMod.buildBase ?? "/";
	const configuredBase = serverMod.configuredBase ?? buildBase;
	if (!isSafeStaticDeployBase(configuredBase)) problems.push(`Vite \`base\` is set to ${JSON.stringify(configuredBase)}, but static exports require a safe origin-root or root-absolute path base:\n    - CDN bases split assets from documents and /_pracht/state/…\n    - relative bases resolve assets beneath each nested page directory\n    - malformed or separator-decoding path segments are not portable across static hosts\n  Use a path base for a sub-path deploy (base: "/my-project/"), or the origin root (base: "/").`);
	const serverRendered = routes.filter((route) => route.render !== "ssg" && route.render !== "spa");
	if (serverRendered.length > 0) {
		const listed = serverRendered.map((route) => `    - ${route.path} (render: "${route.render ?? "ssr"}")`).join("\n");
		problems.push(`these routes render on a server at request time, but a static export has no server:\n${listed}\n  For SSR/ISG ${SERVERFUL_ROUTE_HINT}`);
	}
	const spaWithLoaders = routes.filter((route) => route.render === "spa" && route.hasLoader !== false);
	if (spaWithLoaders.length > 0) problems.push(`these SPA routes declare (or may declare) server loaders, but a static host cannot run them at request time:\n` + spaWithLoaders.map((route) => `    - ${route.path}`).join("\n") + "\n  Static SPA routes must be loaderless. Fetch live data from the browser, change the route to SSG for build-time data, or use a serverful adapter.");
	const spaWithNonFullHydration = routes.filter((route) => route.render === "spa" && route.hydration !== void 0 && route.hydration !== "full");
	if (spaWithNonFullHydration.length > 0) problems.push(`these SPA routes use non-full hydration, but SPA components render entirely in the browser:\n` + spaWithNonFullHydration.map((route) => `    - ${route.path} (hydration: "${route.hydration}")`).join("\n") + "\n  Static SPA routes must use full hydration. Remove the hydration option (or set it to \"full\"), change the route to SSG, or use a serverful adapter.");
	const routesWithMiddleware = pageRoutes.filter((route) => (route.middlewareFiles?.length ?? 0) > 0);
	if (routesWithMiddleware.length > 0) problems.push(`these routes use request middleware, but a static host has no request runtime to enforce it:\n` + routesWithMiddleware.map((route) => `    - ${route.path} (${route.middlewareFiles?.length ?? 0} middleware module(s))`).join("\n") + "\n  Remove the route middleware or use a serverful adapter. Build-time-only transformations belong in loaders or build tooling.");
	if (notFound && notFound.hydration !== void 0 && notFound.hydration !== "full") problems.push(`the notFound page uses hydration: "${notFound.hydration}", but a static host serves one prebuilt 404.html for every unknown URL:\n    - notFound
  Static notFound pages must use full hydration so the client router can adopt the visitor's real URL. Remove the hydration option (or set it to "full"), or use a serverful adapter.`);
	if (serverMod.staticTarget === true && notFound && typeof serverMod.renderStaticNotFoundHtml !== "function") problems.push("the generated server entry cannot render 404.html because it does not export renderStaticNotFoundHtml(). Reuse staticAdapter() or createStaticServerEntryModule() when building a custom static target.");
	if (serverMod.staticTarget === true && serverMod.staticExportConfig?.fallback && typeof serverMod.renderStaticFallbackHtml !== "function") problems.push(`the generated server entry cannot render ${serverMod.staticExportConfig.fallback} because it does not export renderStaticFallbackHtml(). Reuse staticAdapter() or createStaticServerEntryModule() when building a custom static target.`);
	const reservedRoutes = routes.filter((route) => isReservedStaticOutputPath(route.path));
	if (reservedRoutes.length > 0) problems.push(`these routes collide with the reserved /_pracht/ output namespace (route-state files, build metadata):\n` + reservedRoutes.map((route) => `    - ${route.path}`).join("\n"));
	if (serverMod.staticExportConfig?.fallback && !serverMod.staticExportConfig.fallbackHead) {
		const dynamicSpaRoutes = routes.filter((route) => hasDynamicSegments(route.path) && isClientRoutableSpaRoute(route));
		const fallbackRenderedRoutes = notFound ? [...dynamicSpaRoutes, notFound] : dynamicSpaRoutes;
		const headRoutes = [];
		const uninspectableRoutes = [];
		for (const route of fallbackRenderedRoutes) {
			const moduleTargets = [route.file ? {
				file: route.file,
				modules: serverMod.registry?.routeModules,
				source: "route"
			} : null, route.shellFile ? {
				file: route.shellFile,
				modules: serverMod.registry?.shellModules,
				source: "shell"
			} : null].filter(Boolean);
			for (const target of moduleTargets) {
				const importer = target.modules ? resolveRegistryImporter(target.modules, target.file) : void 0;
				if (!importer) {
					uninspectableRoutes.push(`    - ${route.path} (${target.source}: ${target.file})`);
					continue;
				}
				try {
					if (typeof (await importer()).head === "function") headRoutes.push(`    - ${route.path} (${target.source}: ${target.file})`);
				} catch (error) {
					uninspectableRoutes.push(`    - ${route.path} (${target.source}: ${target.file}): ${formatUnknownError(error)}`);
				}
			}
		}
		if (uninspectableRoutes.length > 0) problems.push(`the SPA fallback metadata could not be validated because these fallback-rendered route modules could not be inspected safely:\n` + uninspectableRoutes.join("\n") + "\n  Set an explicit shared `fallbackHead`, fix the module registry, or use a serverful adapter.");
		if (headRoutes.length > 0) problems.push(`these fallback-rendered routes declare route or shell head metadata, but one static fallback document cannot run URL-specific \`head()\` functions:\n` + headRoutes.join("\n") + "\n  Set `staticAdapter({ fallback, fallbackHead })` to explicit metadata shared by every rewritten URL, remove the head export, or use a serverful adapter.");
	}
	const apiRoutes = serverMod.apiRoutes ?? [];
	if (apiRoutes.length > 0) problems.push(`API routes need a server to answer requests, but a static export has none:\n` + apiRoutes.map((route) => `    - ${route.path}`).join("\n") + `\n  Remove them or ${SERVERFUL_ADAPTER_HINT}`);
	const capabilityModules = serverMod.registry?.capabilityModules ?? {};
	const registeredCapabilities = serverMod.resolvedApp?.capabilities ?? {};
	const exposedCapabilities = [];
	const invalidCapabilities = [];
	for (const [name, file] of Object.entries(registeredCapabilities)) {
		const importer = resolveRegistryImporter(capabilityModules, file);
		if (!importer) {
			invalidCapabilities.push(`    - ${name} (${file}): registered module was not found`);
			continue;
		}
		let capabilityModule;
		try {
			capabilityModule = await importer();
		} catch (error) {
			invalidCapabilities.push(`    - ${name} (${file}): ${formatUnknownError(error)}`);
			continue;
		}
		if (!capabilityModule?.default || typeof capabilityModule.default !== "object") {
			invalidCapabilities.push(`    - ${name} (${file}): module has no default capability export`);
			continue;
		}
		const expose = capabilityModule?.default?.expose;
		if (expose && (expose.http || expose.mcp || expose.webmcp)) {
			const surfaces = [
				expose.http ? "http" : null,
				expose.mcp ? "mcp" : null,
				expose.webmcp ? "webmcp" : null
			].filter(Boolean).join(", ");
			exposedCapabilities.push(`    - ${name} (${file}; expose: ${surfaces})`);
		}
	}
	if (invalidCapabilities.length > 0) problems.push(`these registered capabilities could not be loaded, so their network exposure cannot be validated safely:\n` + invalidCapabilities.join("\n"));
	if (exposedCapabilities.length > 0) problems.push(`these capabilities are exposed over the network (HTTP/MCP/WebMCP), which needs a server:\n` + exposedCapabilities.join("\n") + `\n  Drop their \`expose\` config (server-side invokeCapability from build-time loaders still works), or ${SERVERFUL_ADAPTER_HINT}`);
	const mcp = serverMod.resolvedApp?.agents?.mcp;
	if (mcp) {
		const endpoint = mcp.path ?? "/mcp";
		problems.push(`the remote MCP endpoint ${endpoint} needs a server to answer requests, but a static export has none:\n  Remove agents.mcp or ${SERVERFUL_ADAPTER_HINT}`);
	}
	if (problems.length > 0) throw new Error(`Static export (@pracht/adapter-static) cannot build this app:\n\n` + problems.map((problem) => `  • ${problem}`).join("\n\n") + `\n`);
}
/**
* Resolve the output path of a route's serialized route-state JSON:
* Mirrors the client's opaque `buildStaticRouteStateUrl()` scheme and applies
* the same traversal guards as `resolvePrerenderOutputPath`.
*/
function resolveRouteStateOutputPath(clientDir, routePath) {
	if (routePath.includes("\0") || routePath.includes("\\")) throw new Error(`Refusing to write route state for unsafe path ${JSON.stringify(routePath)}.`);
	const stateRoot = resolve(clientDir, "_pracht/state");
	const filePath = resolve(clientDir, `.${buildStaticRouteStateUrl(routePath)}`);
	const relativePath = relative(stateRoot, filePath);
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error(`Refusing to write route state for "${routePath}" outside dist/client/_pracht/state (${filePath}).`);
	return filePath;
}
/**
* Percent-decode a route path into the filesystem path a static host looks up.
*
* A browser asked for `/posts/café` sends `/posts/caf%C3%A9`, and essentially
* every static host (nginx, Apache, S3, GitHub Pages, Netlify, Caddy) decodes
* the request before the filesystem lookup. Writing the encoded form would
* therefore produce a directory literally named `caf%C3%A9` that no ordinary
* link can reach — a page that builds green and 404s in production.
*
* Decoding happens per segment and is re-validated, because a decoded `%2F`
* would smuggle in a path separator and a decoded `%5Fpracht` would slip past
* the reserved-namespace check. Malformed escapes fail the build rather than
* silently falling back to the unreachable literal form.
*/
function decodeStaticOutputPath(routePath) {
	if (!routePath.includes("%")) return routePath;
	return routePath.split("/").map((segment) => {
		let decoded;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			throw new Error(`Static export cannot write prerendered page ${JSON.stringify(routePath)} because segment ${JSON.stringify(segment)} is not valid percent-encoding. Fix the route path or getStaticPaths() param.`);
		}
		if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) throw new Error(`Static export cannot write prerendered page ${JSON.stringify(routePath)} because segment ${JSON.stringify(segment)} decodes to a path separator. Fix the route path or getStaticPaths() param.`);
		if (decoded === "." || decoded === "..") throw new Error(`Static export cannot write prerendered page ${JSON.stringify(routePath)} because segment ${JSON.stringify(segment)} decodes to a relative path segment. Fix the route path or getStaticPaths() param.`);
		return decoded;
	}).join("/");
}
/**
* Best-effort decode used by the guards that must catch both the encoded and
* decoded spelling of a reserved name. It never throws: `decodeStaticOutputPath`
* owns rejecting malformed escapes, and these guards only widen their match.
*/
function decodeOutputSegmentLenient(segment) {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
/**
* Static-export variant of `resolvePrerenderOutputPath`.
*
* Only static exports decode: a static host resolves the request itself, so
* the file has to sit at the decoded path. The serverful adapters keep the
* encoded form because their own static lookup (`resolveStaticFile`) matches
* against the raw `url.pathname` — decoding here would 404 their SSG pages.
*/
function resolveStaticExportOutputPath(clientDir, routePath) {
	return resolvePrerenderOutputPath(clientDir, decodeStaticOutputPath(routePath));
}
function resolvePrerenderOutputPath(clientDir, routePath) {
	if (routePath.includes("\0")) throw new Error(`Refusing to write prerendered route "${routePath}" with a NUL byte.`);
	const root = resolve(clientDir);
	const filePath = routePath === "/" ? resolve(root, "index.html") : resolve(root, `.${routePath}`, "index.html");
	const relativePath = relative(root, filePath);
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error(`Refusing to write prerendered route "${routePath}" outside dist/client (${filePath}).`);
	return filePath;
}
function readStaticNotFoundState(html) {
	const match = /<script id="pracht-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
	if (!match) throw new Error("Static export expected the full-hydration notFound page to contain serialized route state.");
	const state = JSON.parse(match[1]);
	if (state === null || typeof state !== "object" || Array.isArray(state)) throw new Error("Static export expected the notFound route state to be a JSON object.");
	return {
		data: state.data,
		error: state.error
	};
}
/**
* A root splat (`/*`, `/:rest*`) matches every URL, so a fallback document
* always resolves to that route — there is no unmatched URL left to render
* blank. A single dynamic segment (`/:slug`) only covers one path depth.
*/
function matchesEveryPath(routePath) {
	return routePath === "/*" || /^\/:[^/]+\*$/.test(routePath);
}
function hasDynamicSegments(routePath) {
	return routePath.split("/").some((segment) => segment === "*" || segment.startsWith(":"));
}
function isClientRoutableSpaRoute(route) {
	return route.render === "spa" && route.hydration !== "islands" && route.hydration !== "none";
}
function isReservedStaticOutputPath(path) {
	const firstSegment = path.split("/").filter(Boolean)[0];
	if (firstSegment === void 0) return false;
	return firstSegment.toLowerCase() === "_pracht" || decodeOutputSegmentLenient(firstSegment).toLowerCase() === "_pracht";
}
/**
* A SPA catch-all only covers every fallback URL when no earlier dynamic
* route can win matching while being impossible to render client-side. Exact
* SSG routes are safe because their prerendered files prevent the host rewrite
* from reaching the fallback document in the first place.
*/
function hasUnshadowedClientRoutableSpaCatchAll(routes) {
	const catchAllIndex = routes.findIndex((route) => isClientRoutableSpaRoute(route) && matchesEveryPath(route.path));
	if (catchAllIndex === -1) return false;
	return routes.slice(0, catchAllIndex).every((route) => !hasDynamicSegments(route.path) || isClientRoutableSpaRoute(route));
}
function assertNoFixedArtifactRouteCollisions(pages, fixedFiles) {
	const collisions = [];
	for (const page of pages) {
		const rawSegment = page.path.split("/").filter(Boolean)[0];
		if (!rawSegment) continue;
		const firstSegment = rawSegment.toLowerCase();
		const decodedSegment = decodeOutputSegmentLenient(rawSegment).toLowerCase();
		for (const fixedFile of fixedFiles) if (firstSegment === fixedFile.toLowerCase() || decodedSegment === fixedFile.toLowerCase()) collisions.push(`    - ${page.path} conflicts with dist/client/${fixedFile}`);
	}
	if (collisions.length > 0) throw new Error("Static export cannot write its fixed fallback artifacts because prerendered route directories use the same paths:\n" + collisions.join("\n") + "\nRename the route or choose a different staticAdapter({ fallback }) file.");
}
function assertNoPrerenderedPageOutputCollisions(pages) {
	const virtualClientDir = resolve(sep, "__pracht_static_output__");
	const outputs = pages.map((page) => {
		const relativeOutputPath = relative(virtualClientDir, resolveStaticExportOutputPath(virtualClientDir, page.path));
		return {
			pagePath: page.path,
			relativeOutputPath,
			normalizedParts: relativeOutputPath.split(sep).map((part) => normalizePortableOutputPart(part, page.path))
		};
	});
	const collisions = [];
	outputs.sort((left, right) => {
		const sharedLength = Math.min(left.normalizedParts.length, right.normalizedParts.length);
		for (let index = 0; index < sharedLength; index += 1) {
			if (left.normalizedParts[index] < right.normalizedParts[index]) return -1;
			if (left.normalizedParts[index] > right.normalizedParts[index]) return 1;
		}
		return left.normalizedParts.length - right.normalizedParts.length;
	});
	for (let index = 1; index < outputs.length; index += 1) {
		const shorter = outputs[index - 1];
		const longer = outputs[index];
		if (shorter.normalizedParts.length === longer.normalizedParts.length && shorter.normalizedParts.every((part, partIndex) => part === longer.normalizedParts[partIndex])) {
			collisions.push(`    - ${shorter.pagePath} and ${longer.pagePath} map to the same case-insensitive output path dist/client/${shorter.normalizedParts.join("/")}`);
			continue;
		}
		if (shorter.normalizedParts.every((part, partIndex) => part === longer.normalizedParts[partIndex])) collisions.push(`    - ${shorter.pagePath} and ${longer.pagePath} require dist/client/${shorter.relativeOutputPath.split(sep).join("/")} to be both a file and a directory`);
	}
	if (collisions.length > 0) throw new Error("Static export cannot write prerendered pages because their output paths collide:\n" + collisions.join("\n") + "\nChange the route paths or getStaticPaths() output so every page has a distinct, portable filesystem path.");
}
const WINDOWS_RESERVED_OUTPUT_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_INVALID_OUTPUT_CHARACTERS = "<>:\"\\|?*";
const PORTABLE_OUTPUT_COMPONENT_MAX_LENGTH = 255;
function normalizePortableOutputPart(part, pagePath) {
	const normalized = part.normalize("NFC");
	if (normalized.length > PORTABLE_OUTPUT_COMPONENT_MAX_LENGTH || Buffer.byteLength(normalized, "utf-8") > PORTABLE_OUTPUT_COMPONENT_MAX_LENGTH) throw new Error(`Static export cannot write prerendered page ${JSON.stringify(pagePath)} because output component ${JSON.stringify(part)} exceeds the portable 255-byte/code-unit filename limit. Use shorter route segments or getStaticPaths() params.`);
	if ([...normalized].some((character) => WINDOWS_INVALID_OUTPUT_CHARACTERS.includes(character) || character.charCodeAt(0) < 32) || /[ .]$/.test(normalized) || WINDOWS_RESERVED_OUTPUT_NAME_RE.test(normalized)) throw new Error(`Static export cannot write prerendered page ${JSON.stringify(pagePath)} because output component ${JSON.stringify(part)} is not a portable Windows filename. Avoid reserved device names, trailing dots/spaces, and Windows-invalid filename characters.`);
	return normalized.toLowerCase();
}
/**
* Validate every concrete path returned by prerendering before the CLI writes
* any page. Dynamic getStaticPaths() values are not visible in the route
* manifest, so they must be checked at this boundary as well.
*/
function validateStaticExportOutputPaths(pages, serverMod) {
	const reservedPaths = pages.filter((page) => isReservedStaticOutputPath(page.path));
	if (reservedPaths.length > 0) throw new Error("Static export cannot write prerendered pages under the reserved /_pracht/ output namespace:\n" + reservedPaths.map((page) => `    - ${page.path}`).join("\n") + "\nChange getStaticPaths() so it does not emit framework-owned paths.");
	assertNoPrerenderedPageOutputCollisions(pages);
	const configuredFallback = serverMod.staticExportConfig?.fallback ?? null;
	assertNoFixedArtifactRouteCollisions(pages, [...serverMod.resolvedApp?.notFound ? ["404.html"] : [], ...configuredFallback ? [configuredFallback] : []]);
}
/**
* Write the static-deploy artifacts next to the prerendered pages:
* per-route state JSON, `404.html` from the app's notFound page, and the
* optional SPA fallback document.
*/
async function writeStaticExportArtifacts(options) {
	const { clientDir, pages, serverMod, log } = options;
	const configuredFallback = serverMod.staticExportConfig?.fallback ?? null;
	validateStaticExportOutputPaths(pages, serverMod);
	if (serverMod.resolvedApp?.notFound && typeof serverMod.renderStaticNotFoundHtml !== "function") throw new Error("Static export cannot emit 404.html because the static adapter's generated server entry does not export renderStaticNotFoundHtml(). Reuse staticAdapter() or createStaticServerEntryModule() when building a custom static target.");
	if (configuredFallback && typeof serverMod.renderStaticFallbackHtml !== "function") throw new Error(`Static export cannot emit ${configuredFallback} because the static adapter's generated server entry does not export renderStaticFallbackHtml(). Reuse staticAdapter() or createStaticServerEntryModule() when building a custom static target.`);
	let notFoundHtml;
	let notFoundState;
	if (typeof serverMod.renderStaticNotFoundHtml === "function") {
		const renderedNotFoundHtml = await serverMod.renderStaticNotFoundHtml();
		if (renderedNotFoundHtml === null && serverMod.resolvedApp?.notFound) throw new Error("Static export renderStaticNotFoundHtml() must return an HTML string when the app declares a notFound page, received null.");
		if (renderedNotFoundHtml !== null && typeof renderedNotFoundHtml !== "string") throw new Error(`Static export renderStaticNotFoundHtml() must return an HTML string or null, received ${typeof renderedNotFoundHtml}.`);
		notFoundHtml = renderedNotFoundHtml;
		if (typeof notFoundHtml === "string" && configuredFallback) notFoundState = readStaticNotFoundState(notFoundHtml);
	}
	let fallbackHtml;
	if (configuredFallback && typeof serverMod.renderStaticFallbackHtml === "function") {
		const renderedFallbackHtml = await serverMod.renderStaticFallbackHtml(notFoundState);
		if (typeof renderedFallbackHtml !== "string") throw new Error(`Static export renderStaticFallbackHtml() must return an HTML string for ${configuredFallback}, received ${typeof renderedFallbackHtml}.`);
		fallbackHtml = renderedFallbackHtml;
	}
	const fixedOutputs = [...typeof notFoundHtml === "string" ? ["404.html"] : [], ...configuredFallback && typeof fallbackHtml === "string" ? [configuredFallback] : []];
	const existingClientEntries = new Map(readdirSync(clientDir).map((entry) => [portableOutputName(entry), entry]));
	const existingFixedOutputs = fixedOutputs.flatMap((fileName) => {
		const existingFileName = existingClientEntries.get(portableOutputName(fileName));
		return existingFileName ? [{
			existingFileName,
			fileName
		}] : [];
	});
	if (existingFixedOutputs.length > 0) throw new Error("Static export fixed artifact output conflicts with existing files copied from public/ or emitted by Vite:\n" + existingFixedOutputs.map(({ existingFileName, fileName }) => `    - generated ${fileName} conflicts with existing ${existingFileName}`).join("\n") + "\nRemove or rename the conflicting files before building the static export.");
	const stateOutputs = pages.flatMap((page) => typeof page.routeState === "string" ? [{
		filePath: resolveRouteStateOutputPath(clientDir, page.path),
		routePath: page.path,
		routeState: page.routeState
	}] : []);
	const existingStateOutputs = stateOutputs.flatMap(({ filePath, routePath }) => {
		const existingPath = findPortableOutputConflict(clientDir, filePath);
		return existingPath ? [{
			existingPath,
			routePath
		}] : [];
	});
	if (existingStateOutputs.length > 0) throw new Error("Static export route-state output conflicts with existing files copied from public/ or emitted by Vite:\n" + existingStateOutputs.map(({ existingPath, routePath }) => `    - ${routePath} would overwrite ${existingPath}`).join("\n") + "\nRemove the conflicting files from the reserved public/_pracht/state/ namespace.");
	let stateFileCount = 0;
	for (const { filePath, routeState } of stateOutputs) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, routeState, "utf-8");
		stateFileCount += 1;
	}
	if (stateFileCount > 0) log(`\n  Route state → dist/client/_pracht/state (${stateFileCount} file(s))\n`);
	const wrote404 = typeof notFoundHtml === "string";
	if (typeof notFoundHtml === "string") {
		writeFileSync(resolve(clientDir, "404.html"), notFoundHtml, "utf-8");
		log("  404.html → dist/client/404.html\n");
	} else if (notFoundHtml === null) log("  No 404.html emitted: the app declares no notFound page. Static hosts will serve their own error page for unknown URLs.\n");
	let fallbackFile = null;
	if (configuredFallback && typeof fallbackHtml === "string") {
		writeFileSync(resolve(clientDir, configuredFallback), fallbackHtml, "utf-8");
		fallbackFile = configuredFallback;
		log(`  SPA fallback → dist/client/${configuredFallback} (configure your host to rewrite unmatched URLs to it)
`);
		const hasCatchAllRoute = hasUnshadowedClientRoutableSpaCatchAll(serverMod.resolvedApp?.routes ?? []);
		if (!wrote404 && !hasCatchAllRoute) log(`\n  Warning: ${configuredFallback} is emitted but the app declares no notFound page,\n  and no unshadowed client-routable SPA catch-all matches every URL. Behind the host rewrite, unknown URLs render an
  empty document with status 200. Add defineApp({ notFound }) so they render a real
  page, or drop the \`fallback\` option so unknown URLs keep the host's 404.
`);
	}
	return {
		stateFileCount,
		wrote404,
		fallbackFile
	};
}
//#endregion
//#region src/commands/build.ts
var build_exports = /* @__PURE__ */ __exportAll({
	assertNoContentArtifactOutputCollision: () => assertNoContentArtifactOutputCollision,
	assertNoContentArtifactPathCollision: () => assertNoContentArtifactPathCollision,
	assertNoPrerenderedContentArtifactCollisions: () => assertNoPrerenderedContentArtifactCollisions,
	assertNoPublicContentArtifactCollisions: () => assertNoPublicContentArtifactCollisions,
	assertNoPublicContentMetadataCollisions: () => assertNoPublicContentMetadataCollisions,
	assertNoRequestRouteContentArtifactCollisions: () => assertNoRequestRouteContentArtifactCollisions,
	collectContentRoutePatterns: () => collectContentRoutePatterns,
	collectUnroutedContentDocuments: () => collectUnroutedContentDocuments,
	default: () => build_default,
	expandContentArtifactHeaders: () => expandContentArtifactHeaders,
	formatUnroutedContentDocuments: () => formatUnroutedContentDocuments,
	planPrerenderLog: () => planPrerenderLog,
	readContentBuildManifest: () => readContentBuildManifest,
	reportBuildWarning: () => reportBuildWarning,
	resolveGeneratedArtifactOutputPath: () => resolveGeneratedArtifactOutputPath,
	runBuild: () => runBuild
});
/**
* How many prerendered pages the build log names individually.
*
* Enough to see the shape of the output — the home page, a few list pages, the
* first instances of a dynamic route — without a content site turning its build
* into 5,000 lines of scrollback.
*/
const PRERENDER_LOG_LIMIT = 20;
/**
* How many prerendered page lines to name, and the tail that stands in for the
* rest.
*
* The decision is separated from the write loop so the arithmetic is testable
* without running a build: the tail has to appear only when something was
* actually elided, and its count has to agree with the total printed on the
* line above. `limit` is a parameter rather than a captured constant so the
* behaviour stays pinned if {@link PRERENDER_LOG_LIMIT} is retuned.
*/
function planPrerenderLog(pageCount, limit) {
	const named = Math.min(pageCount, limit);
	return {
		named,
		tail: pageCount > named ? `    … and ${pageCount - named} more` : null
	};
}
let prerenderHooksRegistered = false;
function registerPrerenderModuleHooks() {
	if (prerenderHooksRegistered) return;
	prerenderHooksRegistered = true;
	try {
		register("./prerender-module-hooks.mjs", import.meta.url);
	} catch {
		register("../prerender-module-hooks.ts", import.meta.url);
	}
}
var build_default = defineCommand({
	meta: {
		name: "build",
		description: "Production build (client + server)"
	},
	args: {
		analyze: {
			type: "boolean",
			description: "Print a per-route client JavaScript report after the build"
		},
		json: {
			type: "boolean",
			description: "Output the analyze report as JSON (implies --analyze)"
		},
		"budget-fail": {
			type: "boolean",
			default: true,
			description: "Downgrade an exceeded client JS budget to a warning instead of failing"
		}
	},
	async run({ args }) {
		await runBuild(process.cwd(), {
			analyze: Boolean(args.analyze),
			analyzeJson: Boolean(args.json),
			budgetFail: Boolean(args["budget-fail"])
		});
	}
});
function hasTimeRevalidate(revalidate) {
	return (Array.isArray(revalidate) ? revalidate : [revalidate]).some((policy) => typeof policy === "object" && policy !== null && policy.kind === "time" && typeof policy.seconds === "number" && policy.seconds > 0);
}
function indentBlock(block) {
	return block.split("\n").map((line) => line ? `  ${line}` : line).join("\n");
}
/**
* Read and remove the content plugin's single versioned build contribution.
* It is an internal channel and never reaches the published client output.
*/
function readContentBuildManifest(clientDir) {
	const manifestPath = resolve(clientDir, "_pracht/content-manifest.json");
	if (!existsSync(manifestPath)) return null;
	const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
	rmSync(manifestPath, { force: true });
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1 || typeof parsed.artifacts !== "object" || parsed.artifacts === null || Array.isArray(parsed.artifacts)) throw new Error("The content build manifest is invalid.");
	const manifest = parsed;
	for (const [path, headers] of Object.entries(manifest.artifacts)) if (!path.startsWith("/") || !headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string")) throw new Error("The content build manifest is invalid.");
	if (Object.hasOwn(manifest, "routes") && manifest.routes !== void 0) {
		if (!manifest.routes || typeof manifest.routes !== "object" || Array.isArray(manifest.routes) || ![
			"error",
			"warn",
			"ignore"
		].includes(manifest.routes.policy) || typeof manifest.routes.collections !== "object" || manifest.routes.collections === null) throw new Error("The content build manifest is invalid.");
		for (const entries of Object.values(manifest.routes.collections)) if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== "object" || typeof entry.path !== "string" || !entry.path.startsWith("/") || typeof entry.source !== "string")) throw new Error("The content build manifest is invalid.");
	}
	return manifest;
}
function collectContentRoutePatterns(routes, staticExport, hasSpaFallback = false) {
	return routes.map((route) => {
		const dynamic = routePathIsDynamic(route.path);
		return {
			path: route.path,
			servesUnprerenderedPaths: !staticExport || !dynamic || route.render === "spa" && hasSpaFallback
		};
	});
}
function collectUnroutedContentDocuments(manifest, routePatterns, concretePagePaths) {
	const served = new Set(concretePagePaths);
	const unrouted = [];
	for (const [collection, entries] of Object.entries(manifest.collections)) for (const entry of entries) {
		if (served.has(entry.path)) continue;
		const matchingRoute = routePatterns.find((pattern) => Boolean(matchRoutePath(typeof pattern === "string" ? pattern : pattern.path, entry.path)));
		if (matchingRoute && (typeof matchingRoute === "string" || matchingRoute.servesUnprerenderedPaths)) continue;
		unrouted.push({
			collection,
			path: entry.path,
			source: entry.source
		});
	}
	return unrouted;
}
function formatUnroutedContentDocuments(unrouted) {
	const lines = unrouted.map(({ collection, path, source }) => `    ${path} (collection ${JSON.stringify(collection)}, ${source})`);
	return [
		unrouted.length === 1 ? "1 content document generates a route no app route serves:" : `${unrouted.length} content documents generate routes no app route serves:`,
		...lines,
		"",
		"  These documents still reach every artifact generator, so llms.txt and raw",
		"  source assets advertise URLs that answer 404. Register them in the app",
		"  manifest, exclude them with the collection's `route()` callback, or pass",
		"  `unroutedDocuments: \"ignore\"` to prachtContent() for a data-only collection."
	].join("\n");
}
function assertNoContentArtifactPathCollision(contentArtifactHeaders, path, generator) {
	const collision = findContentArtifactOutputCollision(contentArtifactHeaders, path.slice(1));
	if (!collision) return;
	throw new Error(`Content artifact ${JSON.stringify(collision)} collides with ${generator}. Configure a different content artifact path or disable one generator.`);
}
function assertNoContentArtifactOutputCollision(contentArtifactHeaders, outputPath, generator) {
	const collision = findContentArtifactOutputCollision(contentArtifactHeaders, outputPath);
	if (!collision) return;
	throw new Error(`Content artifact ${JSON.stringify(collision)} collides with ${generator}. Configure a different output path or disable one generator.`);
}
function findContentArtifactOutputCollision(contentArtifactHeaders, outputPath) {
	return Object.keys(contentArtifactHeaders).find((path) => portableOutputPathsCollide(path.slice(1), outputPath));
}
function collectPublicFiles(publicDir) {
	const publicFiles = [];
	const collect = (directory, ancestorDirectories) => {
		const realDirectory = realpathSync.native(directory);
		if (ancestorDirectories.has(realDirectory)) return;
		const nextAncestorDirectories = new Set(ancestorDirectories);
		nextAncestorDirectories.add(realDirectory);
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = resolve(directory, entry.name);
			if (statSync(absolutePath).isDirectory()) {
				collect(absolutePath, nextAncestorDirectories);
				continue;
			}
			publicFiles.push(relative(publicDir, absolutePath).split(sep).join("/"));
		}
	};
	collect(publicDir, /* @__PURE__ */ new Set());
	return publicFiles;
}
function assertNoPublicContentMetadataCollisions(publicDir, publicDirLabel = "public") {
	const publicFiles = collectPublicFiles(publicDir);
	const reservedMetadataPaths = ["_pracht/content-manifest.json"];
	const collision = publicFiles.find((publicFile) => reservedMetadataPaths.some((metadataPath) => portableOutputPathsCollide(metadataPath, publicFile)));
	if (!collision) return;
	throw new Error(`${JSON.stringify(`${publicDirLabel}/${collision}`)} collides with Pracht's internal content build manifests. Remove or rename the public file so it cannot replace build metadata.`);
}
function assertNoPublicContentArtifactCollisions(contentArtifactHeaders, publicDir, publicDirLabel = "public") {
	const publicFiles = collectPublicFiles(publicDir);
	for (const path of Object.keys(contentArtifactHeaders)) {
		const artifactOutput = path.slice(1);
		const collision = publicFiles.find((publicFile) => portableOutputPathsCollide(artifactOutput, publicFile));
		if (!collision) continue;
		throw new Error(`Content artifact ${JSON.stringify(path)} collides with ${JSON.stringify(`${publicDirLabel}/${collision}`)}. Remove or rename one of the files so generated artifact bytes and headers cannot diverge.`);
	}
}
function assertNoPrerenderedContentArtifactCollisions(contentArtifactHeaders, clientDir, routePaths) {
	const artifactOutputs = Object.keys(contentArtifactHeaders).map((path) => ({
		outputPath: path.slice(1),
		path
	}));
	for (const routePath of routePaths) {
		const pageOutputPath = relative(resolve(clientDir), resolvePrerenderOutputPath(clientDir, routePath)).split(sep).join("/");
		const collision = artifactOutputs.find(({ outputPath }) => portableOutputPathsCollide(outputPath, pageOutputPath));
		if (!collision) continue;
		throw new Error(`Content artifact ${JSON.stringify(collision.path)} collides with the prerendered output for route ${JSON.stringify(routePath)}. Configure a different artifact path or route.`);
	}
}
function assertNoRequestRouteContentArtifactCollisions(contentArtifactHeaders, pageRoutes, apiRoutes, concretePagePaths) {
	const routeOwners = [
		...pageRoutes.filter((route) => route.render !== "ssg").map((route) => ({
			description: `${route.render ?? "request-time"} page route`,
			path: route.path
		})),
		...apiRoutes.map((route) => ({
			description: "API route",
			path: route.path
		})),
		...concretePagePaths.map((path) => ({
			description: "generated page route",
			path
		}))
	];
	for (const artifactPath of Object.keys(contentArtifactHeaders)) {
		const artifactKey = portablePathKey(artifactPath);
		const collision = routeOwners.find(({ path }) => {
			const routeKey = portablePathKey(path);
			const indexKey = portablePathKey(`${path === "/" ? "" : path}/index.html`);
			return artifactKey === routeKey || artifactKey === indexKey;
		});
		if (!collision) continue;
		throw new Error(`Content artifact ${JSON.stringify(artifactPath)} collides with ${collision.description} ${JSON.stringify(collision.path)}. Configure a different artifact path or route.`);
	}
}
function expandContentArtifactHeaders(contentArtifactHeaders) {
	const expanded = { ...contentArtifactHeaders };
	for (const [path, headers] of Object.entries(contentArtifactHeaders)) {
		if (!path.endsWith("/index.html")) continue;
		const cleanPath = path.slice(0, -11) || "/";
		expanded[cleanPath] ??= headers;
	}
	return expanded;
}
function portablePathKey(value) {
	return value.split("/").map((segment) => segment.normalize("NFC").toLowerCase()).join("/");
}
function portableOutputPathsCollide(left, right) {
	const leftKey = portablePathKey(left);
	const rightKey = portablePathKey(right);
	return leftKey === rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`);
}
function reportBuildWarning(message, json) {
	if (json) console.error(message);
	else console.log(message);
}
async function runBuild(root, options = {}) {
	const analyzeJson = Boolean(options.analyzeJson);
	const analyze = Boolean(options.analyze) || analyzeJson;
	const budgetFail = options.budgetFail ?? true;
	const logLevel = analyzeJson ? "silent" : void 0;
	const log = (message) => {
		if (!analyzeJson) console.log(message);
	};
	let publicDir = resolve(root, "public");
	const capturePublicDir = {
		name: "pracht:capture-public-dir",
		configResolved(config) {
			publicDir = config.publicDir;
		}
	};
	log("\n  Building client...\n");
	await build({
		root,
		logLevel,
		plugins: [capturePublicDir],
		build: {
			outDir: "dist",
			manifest: true,
			rollupOptions: { input: "virtual:pracht/client" }
		}
	});
	log("\n  Building server...\n");
	await build({
		root,
		logLevel,
		build: {
			outDir: "dist/server",
			copyPublicDir: false,
			rollupOptions: { input: "virtual:pracht/server" },
			ssr: true
		}
	});
	const serverEntry = resolve(root, "dist/server/server.js");
	let clientDir;
	if (existsSync(resolve(root, "dist/client/.vite/manifest.json"))) clientDir = resolve(root, "dist/client");
	else {
		clientDir = resolve(root, "dist/client");
		const distRoot = resolve(root, "dist");
		mkdirSync(clientDir, { recursive: true });
		for (const entry of readdirSync(distRoot)) {
			if (entry === "server" || entry === "client") continue;
			const sourcePath = join(distRoot, entry);
			cpSync(sourcePath, join(clientDir, entry), { recursive: true });
			rmSync(sourcePath, {
				force: true,
				recursive: true
			});
		}
	}
	const publicDirLabel = relative(root, publicDir).split(sep).join("/") || ".";
	if (publicDir && existsSync(publicDir)) assertNoPublicContentMetadataCollisions(publicDir, publicDirLabel);
	const contentBuildManifest = readContentBuildManifest(clientDir);
	const contentArtifactHeaders = contentBuildManifest?.artifacts ?? {};
	const contentRoutes = contentBuildManifest?.routes;
	if (publicDir && existsSync(publicDir)) assertNoPublicContentArtifactCollisions(contentArtifactHeaders, publicDir, publicDirLabel);
	let buildTarget = null;
	if (existsSync(serverEntry)) {
		registerPrerenderModuleHooks();
		const serverMod = await import(pathToFileURL(serverEntry).href);
		buildTarget = typeof serverMod.buildTarget === "string" ? serverMod.buildTarget : null;
		const buildBase = typeof serverMod.buildBase === "string" ? serverMod.buildBase : "/";
		const isStaticExport = isStaticExportBuild(serverMod);
		if (isStaticExport) await validateStaticExport(serverMod);
		const { prerenderApp } = serverMod;
		const { clientEntryUrl, clientEntryJs, islandsEntryJs, cssManifest, jsManifest } = readClientBuildAssets(root, buildBase);
		const { pages, isgManifest } = await prerenderApp({
			staticExport: isStaticExport,
			app: serverMod.resolvedApp,
			clientEntryUrl: clientEntryUrl ?? void 0,
			islandsEntryUrl: serverMod.islandsEntryUrl ?? void 0,
			islandsBootstrapRequired: serverMod.islandsBootstrapRequired === true,
			cssManifest,
			jsManifest,
			registry: serverMod.registry,
			withISGManifest: true,
			concurrency: serverMod.prerenderConcurrency
		});
		if (isStaticExport) validateStaticExportOutputPaths(pages, serverMod);
		assertNoRequestRouteContentArtifactCollisions(contentArtifactHeaders, serverMod.resolvedApp?.routes ?? [], serverMod.apiRoutes ?? [], pages.map((page) => page.path));
		if (contentRoutes) {
			const unrouted = collectUnroutedContentDocuments(contentRoutes, collectContentRoutePatterns(serverMod.resolvedApp?.routes ?? [], isStaticExport, Boolean(serverMod.staticExportConfig?.fallback)), pages.map((page) => page.path));
			if (unrouted.length > 0) {
				const report = formatUnroutedContentDocuments(unrouted);
				if (contentRoutes.policy === "error") throw new Error(report);
				reportBuildWarning(`\n  Warning: ${report}\n`, analyzeJson);
			}
		}
		const expandedContentArtifactHeaders = expandContentArtifactHeaders(contentArtifactHeaders);
		const contentArtifactCleanRoutes = Object.keys(expandedContentArtifactHeaders).filter((path) => !(path in contentArtifactHeaders));
		const headersManifest = {
			...Object.fromEntries(pages.map((page) => [page.path, page.headers ?? {}])),
			...expandedContentArtifactHeaders
		};
		const markdownManifest = Object.fromEntries(pages.filter((page) => page.markdown).map((page) => [page.path, true]));
		const cloudflareWorkersCacheEnabled = serverMod.buildTarget === "cloudflare" && serverMod.cloudflareWorkersCacheEnabled === true;
		const edgeCachedIsgPaths = cloudflareWorkersCacheEnabled ? Object.keys(isgManifest).filter((path) => hasTimeRevalidate(isgManifest[path]?.revalidate)) : [];
		const netlifyIsgPaths = serverMod.buildTarget === "netlify" ? Object.keys(isgManifest) : [];
		const skippedSnapshotPaths = new Set([...edgeCachedIsgPaths, ...netlifyIsgPaths]);
		const staticPages = skippedSnapshotPaths.size > 0 ? pages.filter((page) => !skippedSnapshotPaths.has(page.path)) : pages;
		assertNoPrerenderedContentArtifactCollisions(contentArtifactHeaders, clientDir, staticPages.map((page) => page.path));
		if (staticPages.length > 0) {
			log(`\n  Prerendering ${staticPages.length} SSG/ISG route(s)...\n`);
			const prerenderLog = planPrerenderLog(staticPages.length, PRERENDER_LOG_LIMIT);
			let logged = 0;
			for (const page of staticPages) {
				const filePath = isStaticExport ? resolveStaticExportOutputPath(clientDir, page.path) : resolvePrerenderOutputPath(clientDir, page.path);
				mkdirSync(dirname(filePath), { recursive: true });
				writeFileSync(filePath, page.html, "utf-8");
				if (logged < prerenderLog.named) {
					log(`    ${page.path} → ${filePath.replace(root + "/", "")}`);
					logged += 1;
				}
			}
			if (prerenderLog.tail) log(prerenderLog.tail);
		}
		if (typeof serverMod.generateLlmsTxt === "function") {
			assertNoContentArtifactPathCollision(contentArtifactHeaders, "/llms.txt", "Pracht's core llms.txt generator");
			if (existsSync(resolve(root, "public/llms.txt"))) log("\n  Warning: public/llms.txt is overwritten by the generated llms.txt.\n  Remove it, or disable the plugin's `llmsTxt` option to hand-author the file.");
			const llmsTxt = await serverMod.generateLlmsTxt();
			writeFileSync(resolve(clientDir, "llms.txt"), llmsTxt, "utf-8");
			log("\n  llms.txt → dist/client/llms.txt\n");
		}
		const generatedStaticRoutes = [];
		if (typeof serverMod.generatePrachtOpenApiArtifacts === "function") {
			const generated = await serverMod.generatePrachtOpenApiArtifacts();
			const artifacts = Array.isArray(generated?.artifacts) ? generated.artifacts : [];
			const seenOutputPaths = /* @__PURE__ */ new Set();
			for (const artifact of artifacts) {
				if (!artifact || typeof artifact.outputPath !== "string" || typeof artifact.content !== "string") throw new Error("OpenAPI generator returned an invalid build artifact.");
				assertNoContentArtifactOutputCollision(contentArtifactHeaders, artifact.outputPath, `OpenAPI artifact ${JSON.stringify(artifact.outputPath)}`);
				const filePath = resolveGeneratedArtifactOutputPath(clientDir, artifact.outputPath);
				if (seenOutputPaths.has(filePath)) throw new Error(`OpenAPI generator returned duplicate output path ${JSON.stringify(artifact.outputPath)}.`);
				seenOutputPaths.add(filePath);
				if (typeof artifact.path === "string" && artifact.path.startsWith("/") && artifact.outputPath === (artifact.path === "/" ? "index.html" : `${artifact.path.slice(1)}/index.html`)) generatedStaticRoutes.push(artifact.path);
				if (existsSync(filePath)) log(`\n  Warning: OpenAPI artifact ${artifact.outputPath} replaces an existing public/build file.\n`);
				mkdirSync(dirname(filePath), { recursive: true });
				writeFileSync(filePath, artifact.content, "utf-8");
				log(`\n  OpenAPI → dist/client/${artifact.outputPath}\n`);
			}
			const warnings = Array.isArray(generated?.warnings) ? generated.warnings : [];
			for (const warning of warnings) log(`  OpenAPI warning: ${typeof warning?.method === "string" ? `${warning.method} ` : ""}${typeof warning?.path === "string" ? warning.path : "unknown route"}: ${typeof warning?.message === "string" ? warning.message : String(warning)}\n`);
		}
		if (Object.keys(headersManifest).length > 0) {
			const headersManifestJson = `${JSON.stringify(headersManifest, null, 2)}\n`;
			writeFileSync(resolve(root, "dist/server/headers-manifest.json"), headersManifestJson, "utf-8");
			if (!isStaticExport) {
				mkdirSync(resolve(clientDir, "_pracht"), { recursive: true });
				writeFileSync(resolve(clientDir, "_pracht/headers.json"), headersManifestJson, "utf-8");
			}
		}
		const markdownManifestJson = `${JSON.stringify(markdownManifest, null, 2)}\n`;
		writeFileSync(resolve(root, "dist/server/markdown-manifest.json"), markdownManifestJson, "utf-8");
		if (!isStaticExport) {
			mkdirSync(resolve(clientDir, "_pracht"), { recursive: true });
			writeFileSync(resolve(clientDir, "_pracht/markdown.json"), markdownManifestJson, "utf-8");
		}
		if (Object.keys(isgManifest).length > 0) {
			const isgManifestPath = resolve(root, "dist/server/isg-manifest.json");
			const isgManifestJson = `${JSON.stringify(isgManifest, null, 2)}\n`;
			writeFileSync(isgManifestPath, isgManifestJson, "utf-8");
			if (buildTarget === "cloudflare") {
				mkdirSync(resolve(clientDir, "_pracht"), { recursive: true });
				writeFileSync(resolve(clientDir, "_pracht/isg.json"), isgManifestJson, "utf-8");
			}
			log(`\n  ISG manifest → dist/server/isg-manifest.json (${Object.keys(isgManifest).length} route(s))\n`);
		}
		if (isStaticExport) {
			await writeStaticExportArtifacts({
				clientDir,
				pages,
				serverMod,
				log
			});
			if (Object.keys(markdownManifest).length > 0) log("  Note: routes exporting `markdown` rely on server-side content negotiation. A static host always answers with the HTML file; agents requesting `Accept: text/markdown` get HTML. Publish .md files under public/ instead when a raw-markdown corpus matters.\n");
			log("\n  Static export complete → deploy dist/client/ to any static host (dist/server/ is build tooling only).\n");
		}
		if (serverMod.buildTarget === "cloudflare") {
			if (cloudflareWorkersCacheEnabled && edgeCachedIsgPaths.length > 0) log(`\n  ISG via Workers Caching: ${edgeCachedIsgPaths.length} route(s) render on demand and revalidate at the edge. Requires "cache": { "enabled": true } in wrangler config.\n`);
			const entrypointNames = Array.isArray(serverMod.cloudflareWorkerEntrypointNames) ? serverMod.cloudflareWorkerEntrypointNames : [];
			const deployEntryLines = [
				...entrypointNames.length > 0 ? [`export { ${entrypointNames.join(", ")} } from "./server.js";`] : [],
				"export { default } from \"./server.js\";",
				""
			];
			writeFileSync(resolve(root, "dist/server/worker.js"), deployEntryLines.join("\n"), "utf-8");
			log("\n  Cloudflare worker → dist/server/worker.js\n");
			log("  Deploy with: wrangler deploy\n");
		}
		if (serverMod.buildTarget === "vercel") {
			if (Object.keys(isgManifest).length > 0 && typeof serverMod.nodeListener !== "function") throw new Error("The Vercel server entry does not export `nodeListener`, which the ISG routes' serverless functions import. Generate the entry with `vercelAdapter()` or export `createVercelNodeListener(handle)` from your custom entry module.");
			log(`\n  Vercel build output → ${writeVercelBuildOutput({
				base: buildBase,
				functionName: serverMod.vercelFunctionName,
				isgManifest,
				headersManifest,
				markdownRoutes: Object.keys(markdownManifest),
				regions: serverMod.vercelRegions,
				root,
				runtimeRoutes: resolveVercelRuntimeRoutes(serverMod.resolvedApp?.agents),
				staticAssetRoutes: Object.keys(contentArtifactHeaders),
				staticRoutes: [
					...pages.map((page) => page.path).filter((path) => !(path in isgManifest)),
					...generatedStaticRoutes,
					...contentArtifactCleanRoutes
				]
			})}\n`);
		}
		if (typeof serverMod.finalizePrachtBuild === "function") await serverMod.finalizePrachtBuild({
			clientDir,
			root
		});
		const budgets = serverMod.budgets ?? {};
		const hasBudgets = Object.keys(budgets).length > 0;
		if (analyze || hasBudgets) {
			const report = collectBundleReport({
				routes: serverMod.resolvedApp?.routes ?? [],
				jsManifest,
				clientEntryJs,
				islandsEntryJs,
				islandFiles: Array.isArray(serverMod.islandFiles) ? serverMod.islandFiles : [],
				clientDir
			});
			const evaluation = hasBudgets ? evaluateBudgets(report, budgets) : null;
			const color = shouldUseColor();
			if (analyzeJson) console.log(JSON.stringify({
				shared: report.shared,
				routes: report.routes,
				...evaluation ? { budgets: evaluation } : {}
			}, null, 2));
			else if (analyze) console.log(`\n${indentBlock(formatBundleReport(report, { color }))}\n`);
			if (evaluation) {
				writeFileSync(resolve(root, "dist/server/budget-report.json"), `${JSON.stringify({
					generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
					budgets,
					results: evaluation.results,
					unmatched: evaluation.unmatched,
					ok: evaluation.ok
				}, null, 2)}\n`, "utf-8");
				if (!analyzeJson) console.log(`\n${indentBlock(formatBudgetResults(evaluation, { color }))}\n`);
				if (!evaluation.ok) {
					const summary = evaluation.results.filter((result) => !result.ok).map((result) => `${result.path} (${formatBytes(result.gzipBytes)} gzip > ${formatBytes(result.limitBytes)})`).join(", ");
					if (budgetFail) {
						console.error(`\n  Build failed: client JS budget exceeded for ${summary}.\n`);
						process.exitCode = 1;
						return { buildTarget };
					}
					if (!analyzeJson) console.warn(`\n  Warning: client JS budget exceeded for ${summary} (--no-budget-fail).\n`);
				}
			}
		}
	}
	log("\n  Build complete.\n");
	return { buildTarget };
}
function resolveGeneratedArtifactOutputPath(clientDir, outputPath) {
	if (!outputPath || outputPath.includes("\0") || outputPath.includes("\\") || isAbsolute(outputPath)) throw new Error(`Refusing to write generated artifact with unsafe output path ${JSON.stringify(outputPath)}.`);
	const root = resolve(clientDir);
	const filePath = resolve(root, outputPath);
	const relativePath = relative(root, filePath);
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error(`Refusing to write generated artifact ${JSON.stringify(outputPath)} outside dist/client.`);
	return filePath;
}
//#endregion
export { runBuild as n, build_exports as t };
