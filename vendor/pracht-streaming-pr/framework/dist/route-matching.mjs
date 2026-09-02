import { withBase } from "./base.mjs";
import { formatUnknownNameError } from "./name-suggestions.mjs";
//#region src/route-matching.ts
/**
* Pure route matching, path, and href primitives.
*
* This module is the only part of the manifest machinery the client router
* needs at runtime. It must NOT import `resolveApp` or the manifest DSL —
* keeping it dependency-free lets production client builds tree-shake the
* manifest resolution and validation code in `app.ts` that only ever needs
* to run in dev and at build time.
*/
function normalizeRoutePath(path) {
	if (!path || path === "/") return "/";
	const collapsed = (path.startsWith("/") ? path : `/${path}`).replace(/\/{2,}/g, "/");
	return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}
function splitPathSegments(path) {
	return normalizeRoutePath(path).split("/").filter(Boolean);
}
function parseRouteSegments(path) {
	return splitPathSegments(path).map((segment) => {
		if (segment === "*") return {
			type: "catchall",
			name: "*"
		};
		if (segment.startsWith(":") && segment.endsWith("*")) return {
			type: "catchall",
			name: segment.slice(1, -1) || "*"
		};
		if (segment.startsWith(":")) return {
			type: "param",
			name: segment.slice(1)
		};
		assertSafeStaticRouteSegment(segment);
		return {
			type: "static",
			value: segment
		};
	});
}
function assertSafeStaticRouteSegment(segment) {
	if (segment === "." || segment === "..") throw new Error(`Unsafe static route segment "${segment}" is not allowed.`);
	if (segment.includes("\0") || /[\r\n\\]/.test(segment)) throw new Error(`Unsafe static route segment "${segment}" contains a forbidden character.`);
}
function matchRouteSegments(routeSegments, targetSegments) {
	const params = {};
	let routeIndex = 0;
	let targetIndex = 0;
	while (routeIndex < routeSegments.length) {
		const currentSegment = routeSegments[routeIndex];
		if (currentSegment.type === "catchall") {
			try {
				params[currentSegment.name] = targetSegments.slice(targetIndex).map(decodeURIComponent).join("/");
			} catch {
				return null;
			}
			return params;
		}
		const targetSegment = targetSegments[targetIndex];
		if (typeof targetSegment === "undefined") return null;
		if (currentSegment.type === "static") {
			if (currentSegment.value !== targetSegment) return null;
		} else try {
			params[currentSegment.name] = decodeURIComponent(targetSegment);
		} catch {
			return null;
		}
		routeIndex += 1;
		targetIndex += 1;
	}
	return targetIndex === targetSegments.length ? params : null;
}
/** Match one declared route pattern against a concrete pathname. */
function matchRoutePath(pattern, pathname) {
	return matchRouteSegments(parseRouteSegments(pattern), splitPathSegments(pathname));
}
/** Whether a declared route pattern contains a parameter or catch-all segment. */
function routePathIsDynamic(pattern) {
	return parseRouteSegments(pattern).some((segment) => segment.type !== "static");
}
/**
* Match a pathname against an already-resolved app. The client router always
* holds a `ResolvedPrachtApp`, so unlike `matchAppRoute` this never falls
* back to `resolveApp` — that fallback would drag manifest resolution and
* validation into every production client bundle.
*/
function matchResolvedRoute(app, pathname) {
	const normalizedPathname = normalizeRoutePath(pathname);
	const targetSegments = splitPathSegments(normalizedPathname);
	for (const currentRoute of app.routes) {
		const params = matchRouteSegments(currentRoute.segments, targetSegments);
		if (params) return {
			route: currentRoute,
			params,
			pathname: normalizedPathname
		};
	}
}
function buildPathFromSegments(segments, params) {
	return normalizeRoutePath("/" + segments.map((segment) => {
		if (segment.type === "static") return segment.value;
		if (segment.type === "param") return encodeDynamicPathSegment(params[segment.name] ?? "");
		return (params[segment.name] ?? params["*"] ?? "").split("/").map((part) => encodeDynamicPathSegment(part)).join("/");
	}).join("/"));
}
function buildHref(routes, routeId, ...args) {
	return buildHrefUntyped(routes, String(routeId), args[0]);
}
/** @internal Build a route URL before application route registration narrows `RouteId`. */
function buildHrefUntyped(routes, routeId, options = {}) {
	const route = routes.find((candidate) => candidate.id === routeId);
	if (!route) {
		if (import.meta.env?.DEV !== false) throw new Error(formatUnknownNameError({
			kind: "pracht route id",
			kindPlural: "route ids",
			name: routeId,
			registered: routes.flatMap((candidate) => candidate.id ? [candidate.id] : [])
		}));
		throw new Error(`Unknown pracht route id "${routeId}".`);
	}
	const segments = route.segments ?? parseRouteSegments(route.path);
	return `${withBase(buildPathFromSegments(segments, normalizeHrefParams(segments, options.params ?? {})))}${serializeSearch(options.search)}${serializeHash(options.hash)}`;
}
function normalizeHrefParams(segments, params) {
	const expected = new Set(segments.filter((segment) => segment.type === "param" || segment.type === "catchall").map((segment) => segment.name));
	for (const name of expected) if (params[name] == null) throw new Error(`Missing route param: ${name}.`);
	for (const name of Object.keys(params)) if (!expected.has(name)) throw new Error(`Unexpected route param: ${name}.`);
	const normalized = {};
	for (const name of expected) normalized[name] = String(params[name]);
	return normalized;
}
function serializeSearch(search) {
	if (search == null) return "";
	if (typeof search === "string") {
		if (!search) return "";
		return search.startsWith("?") ? search : `?${search}`;
	}
	const serialized = (search instanceof URLSearchParams ? search : objectToSearchParams(search)).toString();
	return serialized ? `?${serialized}` : "";
}
function objectToSearchParams(search) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search)) {
		if (Array.isArray(value)) {
			for (const item of value) appendSearchValue(params, key, item);
			continue;
		}
		appendSearchValue(params, key, value);
	}
	return params;
}
function appendSearchValue(params, key, value) {
	if (value == null) return;
	params.append(key, String(value));
}
function serializeHash(hash) {
	if (!hash) return "";
	return hash.startsWith("#") ? hash : `#${hash}`;
}
/**
* Encode one dynamic URL path segment for SSG/ISG output. `encodeURIComponent`
* leaves unreserved characters (including `.`) intact, and even percent-encoded
* dot segments are normalized by URL parsers. Reject exact `.` / `..` segments
* instead of allowing them to reach filesystem output path construction.
*/
function encodeDynamicPathSegment(part) {
	if (part === "." || part === "..") throw new Error(`Unsafe dynamic route param segment "${part}" is not allowed.`);
	return encodeURIComponent(part);
}
//#endregion
export { buildHref, buildHrefUntyped, buildPathFromSegments, matchResolvedRoute, matchRoutePath, matchRouteSegments, normalizeHrefParams, normalizeRoutePath, parseRouteSegments, routePathIsDynamic, serializeSearch, splitPathSegments };
