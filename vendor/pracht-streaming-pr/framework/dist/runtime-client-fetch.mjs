import { ROUTE_STATE_REQUEST_HEADER } from "./runtime-constants.mjs";
import { IS_STATIC_TARGET, buildStaticRouteStateUrl } from "./runtime-static.mjs";
//#region src/runtime-client-fetch.ts
const SAFE_NAVIGATION_PROTOCOLS = new Set(["http:", "https:"]);
/**
* Parse a possibly-server-supplied redirect target against a base URL and
* return it only if it uses a safe navigation scheme (`http:` or `https:`).
*
* `javascript:`, `data:`, `vbscript:`, `blob:`, `file:` and similar schemes
* can execute script or bypass same-origin assumptions when assigned to
* `window.location.href` — a server-controlled redirect (from a loader,
* middleware, form action response, or API route) must never be able to
* trigger them. Returns `null` for unsafe or unparseable inputs.
*/
function parseSafeNavigationUrl(location, base) {
	let targetUrl;
	try {
		targetUrl = new URL(location, base);
	} catch {
		return null;
	}
	if (!SAFE_NAVIGATION_PROTOCOLS.has(targetUrl.protocol)) return null;
	return targetUrl;
}
function routeNeedsServerFetch(route) {
	if (route.hasLoader === false && route.hasHead === false && route.middlewareFiles.length === 0) return false;
	if (IS_STATIC_TARGET && route.hasStaticPaths === false && routeHasDynamicSegments(route)) return false;
	return true;
}
function routeHasDynamicSegments(route) {
	return route.segments.some((segment) => segment.type === "param" || segment.type === "catchall");
}
function buildRouteStateUrl(url) {
	return `${url}${url.includes("?") ? "&" : "?"}_data=1`;
}
async function fetchPrachtRouteState(url, options) {
	const fetchUrl = IS_STATIC_TARGET ? buildStaticRouteStateUrl(url) : options?.useDataParam ? buildRouteStateUrl(url) : url;
	const response = await fetch(fetchUrl, {
		cache: options?.cache,
		headers: IS_STATIC_TARGET || options?.useDataParam ? {} : { [ROUTE_STATE_REQUEST_HEADER]: "1" },
		redirect: "manual",
		signal: options?.signal
	});
	if (response.type === "opaqueredirect" || response.status >= 300 && response.status < 400) return {
		location: response.headers.get("location") ?? url,
		type: "redirect"
	};
	const json = await response.json();
	if (json.redirect) return {
		location: json.redirect,
		type: "redirect"
	};
	if (!response.ok) {
		if (json.error) return {
			error: json.error,
			fontHead: json.fontHead,
			type: "error"
		};
		throw new Error(`Failed to fetch route state (${response.status})`);
	}
	return {
		data: json.data,
		fontHead: json.fontHead,
		type: "data"
	};
}
async function navigateToClientLocation(location, options) {
	if (typeof window === "undefined") return;
	const targetUrl = parseSafeNavigationUrl(location, window.location.href);
	if (!targetUrl) {
		console.error(`[pracht] refused to navigate to unsafe URL: ${location}`);
		return;
	}
	const target = targetUrl.pathname + targetUrl.search + targetUrl.hash;
	if (targetUrl.origin === window.location.origin && window.__PRACHT_NAVIGATE__) {
		await window.__PRACHT_NAVIGATE__(target, {
			_reloadRouteState: options?.reloadRouteState,
			replace: options?.replace
		});
		return;
	}
	if (options?.replace) {
		window.location.replace(targetUrl.toString());
		return;
	}
	window.location.href = targetUrl.toString();
}
//#endregion
export { buildRouteStateUrl, fetchPrachtRouteState, navigateToClientLocation, parseSafeNavigationUrl, routeNeedsServerFetch };
