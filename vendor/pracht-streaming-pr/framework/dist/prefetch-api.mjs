import { stripBase, withBase } from "./base.mjs";
import { buildHrefUntyped, matchResolvedRoute } from "./route-matching.mjs";
import { fetchPrachtRouteState, routeNeedsServerFetch } from "./runtime-client-fetch.mjs";
import { EMPTY_ROUTE_STATE_PROMISE, cacheRouteState, getCachedRouteState, removeCachedRouteState } from "./prefetch-cache.mjs";
//#region src/prefetch-api.ts
/**
* Imperative prefetch surface shared by the lazy prefetch listeners
* (`prefetch.ts`), the client router, and userland code via the public
* `prefetch()` export. Kept separate from `prefetch.ts` so importing the
* public API does not pull the document-level listener setup into the
* critical hydration path — every module imported here is already part of
* the core client bundle.
*/
let activePrefetchTarget = null;
/**
* Called by the client router during initialization so prefetching can match
* URLs against the resolved app and warm route/shell module chunks.
*/
function registerPrefetchTarget(app, warmModules) {
	activePrefetchTarget = {
		app,
		warmModules
	};
}
/**
* Fetch (or reuse) the route-state JSON for `url` and store it in the shared
* bounded prefetch cache so a subsequent client navigation can consume it
* without a second network request. Rejected fetches are evicted from the
* cache so a transient network error does not poison later navigations.
*/
function prefetchRouteState(url, route) {
	if (route && !routeNeedsServerFetch(route)) return EMPTY_ROUTE_STATE_PROMISE;
	const cached = getCachedRouteState(url);
	if (cached) return cached;
	const promise = fetchPrachtRouteState(url);
	cacheRouteState(url, promise);
	promise.catch(() => removeCachedRouteState(url, promise));
	return promise;
}
/**
* Imperatively prefetch a route: warms the route/shell module chunks and
* caches the route-state JSON in the shared prefetch cache. Accepts an href
* string or a typed route target (`{ route, params, search }`).
*
* Available once the client router has initialized; a no-op during SSR,
* before hydration, and for URLs that do not match a client route.
*/
const prefetch = async (to) => {
	if (typeof window === "undefined") return;
	const target = activePrefetchTarget;
	if (!target) return;
	let href;
	try {
		href = typeof to === "string" ? withBase(to) : buildHrefUntyped(target.app.routes, to.route, to);
	} catch {
		return;
	}
	let url;
	try {
		url = new URL(href, window.location.href);
	} catch {
		return;
	}
	if (url.origin !== window.location.origin) return;
	const routePathname = stripBase(url.pathname);
	if (routePathname === null) return;
	const match = matchResolvedRoute(target.app, routePathname);
	if (!match) return;
	target.warmModules?.(match);
	await prefetchRouteState(url.pathname + url.search, match.route).catch(() => {});
};
//#endregion
export { prefetch, prefetchRouteState, registerPrefetchTarget };
