import { formatUnknownNameError } from "./name-suggestions.mjs";
import { NOT_FOUND_ROUTE_ID, NOT_FOUND_ROUTE_PATH } from "./runtime-constants.mjs";
import { matchResolvedRoute, matchRouteSegments, normalizeRoutePath, parseRouteSegments, splitPathSegments } from "./route-matching.mjs";
import { isValidCapabilityHttpPath } from "@pracht/capabilities";
//#region src/app.ts
const VALIDATE_MANIFEST = import.meta.env?.DEV !== false;
const VALIDATE_META_KEYS = import.meta.env?.SSR !== false;
function timeRevalidate(seconds) {
	if (!Number.isInteger(seconds) || seconds <= 0) throw new Error("timeRevalidate expects a positive integer number of seconds.");
	return {
		kind: "time",
		seconds
	};
}
function webhookRevalidate() {
	return { kind: "webhook" };
}
function route(path, fileOrConfig, meta = {}) {
	if (typeof fileOrConfig === "string" || typeof fileOrConfig === "function") return {
		kind: "route",
		path: normalizeRoutePath(path),
		file: resolveModuleRef(fileOrConfig),
		...meta
	};
	const { component, loader, ...routeMeta } = fileOrConfig;
	return {
		kind: "route",
		path: normalizeRoutePath(path),
		file: resolveModuleRef(component),
		loaderFile: resolveModuleRef(loader),
		hasLoader: !!loader,
		...routeMeta
	};
}
function resolveModuleRef(ref) {
	if (ref === void 0) return void 0;
	if (typeof ref === "string") return ref;
	throw new Error("Invalid ModuleRef: expected a string path, but received a function at runtime. Use a plain string path (e.g. \"./routes/home.tsx\"), or ensure the Vite plugin rewrites inline `() => import(\"./file\")` refs in the app manifest.");
}
function group(meta, routes) {
	return {
		kind: "group",
		meta,
		routes
	};
}
function defineApp(config) {
	return {
		shells: resolveModuleRefRecord(config.shells ?? {}),
		middleware: resolveModuleRefRecord(config.middleware ?? {}),
		capabilities: resolveModuleRefRecord(config.capabilities ?? {}),
		agents: config.agents,
		api: config.api ?? {},
		routes: config.routes,
		notFound: resolveNotFoundDefinition(config.notFound),
		constraints: config.constraints,
		viewTransitions: config.viewTransitions
	};
}
function resolveNotFoundDefinition(notFound) {
	if (notFound === void 0) return void 0;
	if (typeof notFound === "string" || typeof notFound === "function") return { file: resolveModuleRef(notFound) };
	assertKnownMetaKeys(notFound, NOT_FOUND_CONFIG_KEYS, "the notFound page");
	const { component, loader, ...meta } = notFound;
	return {
		file: resolveModuleRef(component),
		loaderFile: resolveModuleRef(loader),
		hasLoader: loader ? true : void 0,
		...meta
	};
}
function resolveModuleRefRecord(record) {
	const result = {};
	for (const [key, value] of Object.entries(record)) result[key] = resolveModuleRef(value);
	return result;
}
function resolveApp(app) {
	const routes = [];
	const inherited = {
		pathPrefix: "/",
		middleware: []
	};
	if (VALIDATE_MANIFEST) {
		for (const name of app.api?.middleware ?? []) if (!hasOwnEntry(app.middleware, name)) throw new Error(formatUnknownNameError({
			kind: "middleware",
			kindPlural: "middleware",
			name,
			registered: Object.keys(app.middleware),
			context: "api routes"
		}));
	}
	validateAgentsConfig(app.agents);
	for (const node of app.routes) flattenRouteNode(app, node, inherited, routes);
	return {
		shells: app.shells,
		middleware: app.middleware,
		capabilities: app.capabilities ?? {},
		agents: app.agents,
		api: app.api,
		routes,
		apiRoutes: [],
		notFound: resolveNotFoundRoute(app),
		constraints: app.constraints,
		viewTransitions: app.viewTransitions
	};
}
/**
* Shape the not-found page like a `ResolvedRoute` so the runtime and the
* client router can render it through the normal pipeline. It inherits
* nothing from groups (it sits outside the route tree), always renders on
* demand (`ssr` — never prerendered), and its `segments` are empty because
* matching never reaches it.
*/
function resolveNotFoundRoute(app) {
	const notFound = app.notFound;
	if (!notFound) return void 0;
	const middleware = notFound.middleware ?? [];
	if (VALIDATE_MANIFEST && notFound.shell !== void 0 && !hasOwnEntry(app.shells, notFound.shell)) throw new Error(formatUnknownNameError({
		kind: "shell",
		name: notFound.shell,
		registered: Object.keys(app.shells),
		context: "the notFound page"
	}));
	return {
		id: NOT_FOUND_ROUTE_ID,
		path: NOT_FOUND_ROUTE_PATH,
		file: notFound.file,
		loaderFile: notFound.loaderFile,
		hasLoader: notFound.loaderFile ? true : notFound.hasLoader,
		shell: notFound.shell,
		shellFile: notFound.shell !== void 0 ? app.shells[notFound.shell] : void 0,
		render: "ssr",
		hydration: notFound.hydration,
		middleware,
		middlewareFiles: middleware.map((name) => {
			if (VALIDATE_MANIFEST && !hasOwnEntry(app.middleware, name)) throw new Error(formatUnknownNameError({
				kind: "middleware",
				kindPlural: "middleware",
				name,
				registered: Object.keys(app.middleware),
				context: "the notFound page"
			}));
			return app.middleware[name];
		}),
		segments: []
	};
}
function matchAppRoute(app, pathname) {
	return matchResolvedRoute(isResolvedApp(app) ? app : resolveApp(app), pathname);
}
function flattenRouteNode(app, node, inherited, routes) {
	if (node.kind === "group") {
		const pathPrefix = mergeRoutePaths(inherited.pathPrefix, node.meta.pathPrefix);
		assertKnownMetaKeys(node.meta, GROUP_META_KEYS, `group at "${pathPrefix}"`);
		if (VALIDATE_MANIFEST) assertValidLoaderCache(node.meta.loaderCache, `group at "${pathPrefix}"`);
		const nextInherited = {
			pathPrefix,
			shell: node.meta.shell ?? inherited.shell,
			render: node.meta.render ?? inherited.render,
			hydration: node.meta.hydration ?? inherited.hydration,
			loaderCache: node.meta.loaderCache ?? inherited.loaderCache,
			streaming: node.meta.streaming ?? inherited.streaming,
			middleware: [...inherited.middleware, ...node.meta.middleware ?? []],
			speculation: node.meta.speculation ?? inherited.speculation
		};
		for (const child of node.routes) flattenRouteNode(app, child, nextInherited, routes);
		return;
	}
	const fullPath = mergeRoutePaths(inherited.pathPrefix, node.path);
	if (!isResolvedRouteNode(node)) assertKnownMetaKeys(node, ROUTE_NODE_KEYS, `route "${fullPath}"`);
	const shell = node.shell ?? inherited.shell;
	const middleware = [...inherited.middleware, ...node.middleware ?? []];
	const render = node.render ?? inherited.render;
	const hydration = node.hydration ?? inherited.hydration;
	const loaderCache = node.loaderCache ?? inherited.loaderCache;
	const streaming = node.streaming ?? inherited.streaming;
	if (VALIDATE_MANIFEST) {
		assertValidLoaderCache(node.loaderCache, `route "${fullPath}"`);
		if (render === "spa" && hydration !== void 0 && hydration !== "full") throw new Error(`Route "${fullPath}" combines render: "spa" with hydration: "${hydration}". SPA routes render entirely in the browser and always use full hydration — remove the hydration option or use render: "ssg" / "isg" / "ssr".`);
		if (streaming) {
			if (render !== void 0 && render !== "ssr") throw new Error(`Route "${fullPath}" combines streaming: true with render: "${render}". Streaming applies to render: "ssr" only — a prerendered file cannot stream, and SPA routes render no markup on the server.`);
			if (hydration !== void 0 && hydration !== "full") throw new Error(`Route "${fullPath}" combines streaming: true with hydration: "${hydration}". Streamed boundaries are resumed by the client runtime, which only hydration: "full" ships.`);
		}
		if (shell !== void 0 && !hasOwnEntry(app.shells, shell)) throw new Error(formatUnknownNameError({
			kind: "shell",
			name: shell,
			registered: Object.keys(app.shells),
			context: `route "${fullPath}"`
		}));
	}
	routes.push({
		id: node.id ?? createRouteId(fullPath),
		path: fullPath,
		file: node.file,
		loaderFile: node.loaderFile,
		hasLoader: node.loaderFile ? true : node.hasLoader,
		hasHead: node.hasHead,
		hasStaticPaths: node.hasStaticPaths,
		shell,
		shellFile: shell !== void 0 ? app.shells[shell] : void 0,
		render,
		hydration,
		loaderCache,
		streaming,
		markdown: node.markdown,
		middleware,
		middlewareFiles: middleware.map((name) => {
			if (VALIDATE_MANIFEST && !hasOwnEntry(app.middleware, name)) throw new Error(formatUnknownNameError({
				kind: "middleware",
				kindPlural: "middleware",
				name,
				registered: Object.keys(app.middleware),
				context: `route "${fullPath}"`
			}));
			return app.middleware[name];
		}),
		prefetch: node.prefetch,
		revalidate: node.revalidate,
		speculation: node.speculation ?? inherited.speculation,
		segments: parseRouteSegments(fullPath)
	});
}
function assertValidLoaderCache(loaderCache, context) {
	if (loaderCache !== void 0 && loaderCache !== false && (!Number.isInteger(loaderCache) || loaderCache < 0)) throw new Error(`Invalid loaderCache for ${context}: expected false or a non-negative integer number of seconds.`);
}
/** `in` would also match `Object.prototype` keys such as `constructor`. */
function hasOwnEntry(record, name) {
	return Object.prototype.hasOwnProperty.call(record, name);
}
const ROUTE_NODE_KEYS = [
	...[
		"hasHead",
		"hasLoader",
		"hasStaticPaths",
		"hydration",
		"id",
		"loaderCache",
		"markdown",
		"middleware",
		"prefetch",
		"render",
		"revalidate",
		"shell",
		"speculation",
		"streaming"
	],
	"file",
	"kind",
	"loaderFile",
	"path"
];
const GROUP_META_KEYS = [
	"hydration",
	"loaderCache",
	"middleware",
	"pathPrefix",
	"render",
	"shell",
	"speculation",
	"streaming"
];
const NOT_FOUND_CONFIG_KEYS = [
	"component",
	"hydration",
	"loader",
	"middleware",
	"shell"
];
/**
* Reject meta keys the resolver does not read.
*
* Runs whenever the manifest is resolved on a server — including production
* server/edge bundles, where `VALIDATE_MANIFEST` folds to `false`. That guard
* is wrong for this check: `group({ middlewares: ["auth"] })` or
* `route(..., { middlware: ["auth"] })` used to resolve to a route with no
* middleware at all, and every static check (`pracht verify`, `doctor`,
* `requireMiddleware` constraints, the graph snapshot) still reported the
* route as guarded.
*
* It is gated on `VALIDATE_META_KEYS` rather than shipped everywhere, because
* the browser cannot catch anything here: `resolveApp()` runs client-side on a
* manifest the server already accepted, so the check would be pure bundle
* weight (~300 bytes gzip, plus it re-anchors `formatUnknownNameError` in the
* shared chunk).
*
* TypeScript rejects an inline object literal with an unknown key, but excess-
* property checking does not apply to a meta object built separately and
* passed by reference, and the manifest is also read by JavaScript callers and
* by builds that never run `tsc`.
*/
/** A route node that already went through `resolveApp()`. */
function isResolvedRouteNode(node) {
	return "segments" in node;
}
function assertKnownMetaKeys(meta, allowed, context) {
	if (!VALIDATE_META_KEYS) return;
	for (const key of Object.keys(meta)) {
		if (allowed.includes(key)) continue;
		throw new Error(formatUnknownNameError({
			kind: "option",
			kindPlural: "options",
			name: key,
			registered: allowed,
			context
		}));
	}
}
const AGENT_POLICY_MODES = ["observe", "require"];
const CONFIRMATION_MODES = ["token", "human"];
/**
* Validate `defineApp({ agents })`. The security-relevant setting — the Web
* Bot Auth `policy` — is compared with `=== "require"` at dispatch, so a typo
* (`"requre"`) would silently fail open. Reject unknown policies and
* non-positive numeric trust settings so the manifest fails closed instead.
*/
function validateAgentsConfig(agents) {
	if (!agents) return;
	const { webBotAuth, confirmation, mcp } = agents;
	if (webBotAuth) {
		if (webBotAuth.policy !== void 0 && !AGENT_POLICY_MODES.includes(webBotAuth.policy)) throw new Error(`defineApp({ agents.webBotAuth.policy }) must be one of ${AGENT_POLICY_MODES.map((mode) => `"${mode}"`).join(", ")}, got ${JSON.stringify(webBotAuth.policy)}.`);
		for (const key of [
			"clockSkewSeconds",
			"maxLifetimeSeconds",
			"directoryCacheTtlSeconds"
		]) assertPositiveNumber(webBotAuth[key], `agents.webBotAuth.${key}`);
	}
	if (confirmation) {
		if (confirmation.mode !== void 0 && !CONFIRMATION_MODES.includes(confirmation.mode)) throw new Error(`defineApp({ agents.confirmation.mode }) must be one of ${CONFIRMATION_MODES.map((mode) => `"${mode}"`).join(", ")}, got ${JSON.stringify(confirmation.mode)}.`);
		assertPositiveNumber(confirmation.ttlSeconds, "agents.confirmation.ttlSeconds");
	}
	if (mcp?.path !== void 0 && !isValidCapabilityHttpPath(mcp.path)) throw new Error("defineApp({ agents.mcp.path }) must be an exact same-origin pathname starting with \"/\".");
}
function assertPositiveNumber(value, label) {
	if (value === void 0) return;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`defineApp({ ${label} }) must be a positive number, got ${JSON.stringify(value)}.`);
}
function isResolvedApp(app) {
	return app.routes.length === 0 || "segments" in app.routes[0];
}
function mergeRoutePaths(prefix, path) {
	if (!path) return normalizeRoutePath(prefix);
	const normalizedPrefix = normalizeRoutePath(prefix);
	const normalizedPath = normalizeRoutePath(path);
	if (normalizedPrefix === "/") return normalizedPath;
	if (normalizedPath === "/") return normalizedPrefix;
	return normalizeRoutePath(`${normalizedPrefix}/${normalizedPath.slice(1)}`);
}
/**
* Convert a list of file paths from `import.meta.glob` into resolved API routes.
*
* Example: `"/src/api/health.ts"` → path `/api/health`
*          `"/src/api/users/[id].ts"` → path `/api/users/:id`
*          `"/src/api/files/[...path].ts"` → path `/api/files/*`
*          `"/src/api/index.ts"` → path `/api`
*/
function resolveApiRoutes(files, apiDir = "/src/api") {
	const normalizedDir = apiDir.replace(/\/$/, "");
	return files.filter((file) => !/\.d\.ts$/i.test(file)).map((file) => {
		let relative = file;
		if (relative.startsWith(normalizedDir)) relative = relative.slice(normalizedDir.length);
		relative = relative.replace(/\.(ts|tsx|js|jsx)$/, "");
		if (relative.endsWith("/index")) relative = relative.slice(0, -6) || "/";
		relative = relative.replace(/\[\.\.\.[^\]]+\]/g, "*");
		relative = relative.replace(/\[([^\]]+)\]/g, ":$1");
		const path = normalizeRoutePath(`/api${relative}`);
		return {
			path,
			file,
			segments: parseRouteSegments(path)
		};
	}).sort(compareResolvedApiRoutes);
}
function matchApiRoute(apiRoutes, pathname) {
	const normalizedPathname = normalizeRoutePath(pathname);
	const targetSegments = splitPathSegments(normalizedPathname);
	for (const route of apiRoutes) {
		const params = matchRouteSegments(route.segments, targetSegments);
		if (params) return {
			route,
			params,
			pathname: normalizedPathname
		};
	}
}
function createRouteId(path) {
	if (path === "/") return "index";
	return path.slice(1).split("/").map((segment) => {
		if (segment === "*") return "splat";
		return segment.startsWith(":") ? segment.slice(1) : segment;
	}).join("-").replace(/[^a-zA-Z0-9-]/g, "-");
}
function compareResolvedApiRoutes(left, right) {
	const length = Math.max(left.segments.length, right.segments.length);
	for (let index = 0; index < length; index += 1) {
		const leftSegment = left.segments[index];
		const rightSegment = right.segments[index];
		if (!leftSegment) return 1;
		if (!rightSegment) return -1;
		const leftScore = getRouteSegmentSpecificity(leftSegment);
		const rightScore = getRouteSegmentSpecificity(rightSegment);
		if (leftScore !== rightScore) return rightScore - leftScore;
	}
	return left.path.localeCompare(right.path);
}
function getRouteSegmentSpecificity(segment) {
	if (segment.type === "static") return 3;
	if (segment.type === "param") return 2;
	return 1;
}
//#endregion
export { defineApp, group, matchApiRoute, matchAppRoute, resolveApiRoutes, resolveApp, route, timeRevalidate, webhookRevalidate };
