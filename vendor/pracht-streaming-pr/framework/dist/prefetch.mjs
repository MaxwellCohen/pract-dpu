import { stripBase } from "./base.mjs";
import { PREFETCH_ATTRIBUTE, SPECULATE_ATTRIBUTE } from "./runtime-constants.mjs";
import { matchResolvedRoute } from "./route-matching.mjs";
import { trimMapToSize } from "./prefetch-cache.mjs";
import { isSpeculationSuppressed, normalizeSpeculation, supportsSpeculationRules } from "./runtime-speculation.mjs";
import { prefetchRouteState } from "./prefetch-api.mjs";
//#region src/prefetch.ts
const MAX_MATCH_CACHE_ENTRIES = 250;
const LINK_PREFETCH_STRATEGIES = new Set([
	"none",
	"hover",
	"intent",
	"viewport",
	"render"
]);
function setupPrefetching(app, warmModules) {
	let hoverTimer = null;
	const renderPrefetchedAnchors = /* @__PURE__ */ new WeakSet();
	const observedAnchors = /* @__PURE__ */ new WeakSet();
	const matchCache = /* @__PURE__ */ new Map();
	const browserSupportsSpeculationRules = supportsSpeculationRules();
	/** Route path for an href, or null when it is unparseable or outside the base. */
	function getRoutePathname(url) {
		try {
			return stripBase(new URL(url, window.location.href).pathname);
		} catch {
			return null;
		}
	}
	function getInternalHref(anchor) {
		const href = anchor.getAttribute("href");
		if (!href || href.startsWith("#")) return null;
		let url;
		try {
			url = new URL(href, window.location.href);
		} catch {
			return null;
		}
		if (url.origin !== window.location.origin) return null;
		return url.pathname + url.search;
	}
	function getMatchEntry(href) {
		const cached = matchCache.get(href);
		if (cached) {
			matchCache.delete(href);
			matchCache.set(href, cached);
			return cached;
		}
		const routePathname = getRoutePathname(href);
		const match = routePathname ? matchResolvedRoute(app, routePathname) ?? null : null;
		const isFullDocumentRoute = match?.route.hydration === "islands" || match?.route.hydration === "none";
		const entry = {
			match,
			strategy: match && !isFullDocumentRoute ? match.route.prefetch ?? "intent" : "none"
		};
		matchCache.set(href, entry);
		trimMapToSize(matchCache, MAX_MATCH_CACHE_ENTRIES);
		return entry;
	}
	/**
	* Per-anchor `data-pracht-prefetch` (rendered by `<Link prefetch>`) wins
	* over the route-level strategy; unmatched hrefs are never prefetched.
	*/
	function getAnchorStrategy(anchor, href) {
		const entry = getMatchEntry(href);
		if (!entry.match) return "none";
		if (entry.match.route.hydration === "islands" || entry.match.route.hydration === "none") return "none";
		if (browserSupportsSpeculationRules && normalizeSpeculation(entry.match.route.speculation)?.mode === "prerender" && !isSpeculationSuppressed(anchor)) return "none";
		const override = anchor.getAttribute(PREFETCH_ATTRIBUTE);
		if (override && LINK_PREFETCH_STRATEGIES.has(override)) return override;
		return entry.strategy;
	}
	function prefetchHref(href) {
		const match = getMatchEntry(href).match;
		if (!match) return;
		prefetchRouteState(href, match.route);
		if (warmModules) warmModules(match);
	}
	function prefetchAnchorOnIntent(anchor, debounce) {
		const href = getInternalHref(anchor);
		if (!href) return;
		const strategy = getAnchorStrategy(anchor, href);
		if (strategy !== "hover" && strategy !== "intent") return;
		if (!debounce) {
			prefetchHref(href);
			return;
		}
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			prefetchHref(href);
		}, 50);
	}
	document.addEventListener("mouseenter", (e) => {
		const anchor = e.target.closest?.("a");
		if (!anchor) return;
		prefetchAnchorOnIntent(anchor, true);
	}, true);
	document.addEventListener("mouseleave", (e) => {
		if (!e.target.closest?.("a")) return;
		if (hoverTimer) {
			clearTimeout(hoverTimer);
			hoverTimer = null;
		}
	}, true);
	document.addEventListener("focusin", (e) => {
		const anchor = e.target.closest?.("a");
		if (!anchor) return;
		prefetchAnchorOnIntent(anchor, false);
	}, true);
	const hoveredAnchor = document.querySelector("a:hover");
	if (hoveredAnchor) prefetchAnchorOnIntent(hoveredAnchor, true);
	const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const anchor = entry.target;
			const href = getInternalHref(anchor);
			if (!href || getAnchorStrategy(anchor, href) !== "viewport") {
				observer?.unobserve(anchor);
				observedAnchors.delete(anchor);
				continue;
			}
			prefetchHref(href);
			observer?.unobserve(anchor);
			observedAnchors.delete(anchor);
		}
	}, { rootMargin: "200px" });
	function processAnchor(anchor) {
		const href = getInternalHref(anchor);
		if (!href) {
			if (observedAnchors.delete(anchor)) observer?.unobserve(anchor);
			return;
		}
		const strategy = getAnchorStrategy(anchor, href);
		if (strategy === "render") {
			if (observedAnchors.delete(anchor)) observer?.unobserve(anchor);
			if (!renderPrefetchedAnchors.has(anchor)) {
				renderPrefetchedAnchors.add(anchor);
				prefetchHref(href);
			}
			return;
		}
		if (strategy === "viewport" && observer) {
			if (!observedAnchors.has(anchor)) {
				observedAnchors.add(anchor);
				observer.observe(anchor);
			}
			return;
		}
		if (observedAnchors.delete(anchor)) observer?.unobserve(anchor);
	}
	function processAnchors(root) {
		if (root instanceof HTMLAnchorElement) processAnchor(root);
		for (const anchor of root.querySelectorAll("a[href]")) processAnchor(anchor);
	}
	processAnchors(document.body);
	new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes") {
				if (record.attributeName === "data-pracht-speculate") processAnchors(record.target);
				else if (record.target instanceof HTMLAnchorElement) processAnchor(record.target);
				continue;
			}
			for (const node of record.addedNodes) if (node instanceof HTMLElement || node instanceof DocumentFragment) processAnchors(node);
		}
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: [SPECULATE_ATTRIBUTE, "rel"],
		childList: true,
		subtree: true
	});
}
//#endregion
export { setupPrefetching };
