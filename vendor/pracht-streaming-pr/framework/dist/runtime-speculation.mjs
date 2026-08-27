import { SPECULATE_ATTRIBUTE } from "./runtime-constants.mjs";
import { PRACHT_BASE } from "./base.mjs";
//#region src/runtime-speculation.ts
/**
* Links the browser must never speculate, regardless of the route patterns
* a rule matches. Emitted as a `not: { selector_matches }` conjunct on every
* rule, and mirrored on the client by `isSpeculationSuppressed()`.
*
* - `rel="nofollow"` marks a link the page does not vouch for.
* - `data-pracht-speculate="off"` opts an element and every hyperlink in its
*   subtree out. A link can explicitly re-enable itself with `"on"`.
*   Container-level `"on"` scopes are deliberately unsupported because CSS
*   selectors cannot express nearest-ancestor precedence for arbitrarily
*   nested scopes; keeping `"off"` fail-closed makes the browser and client
*   agree for every nesting depth.
*/
const SPECULATION_EXCLUSION_SELECTORS = [
	"a[rel~=\"nofollow\"]",
	"area[rel~=\"nofollow\"]",
	`a[${SPECULATE_ATTRIBUTE}="off"]`,
	`area[${SPECULATE_ATTRIBUTE}="off"]`,
	`[${SPECULATE_ATTRIBUTE}="off"] a:not([${SPECULATE_ATTRIBUTE}="on"])`,
	`[${SPECULATE_ATTRIBUTE}="off"] area:not([${SPECULATE_ATTRIBUTE}="on"])`
];
/**
* True when this link is excluded from the emitted speculation rules — the
* client-side counterpart of `SPECULATION_EXCLUSION_SELECTORS`. The router and
* prefetch listeners consult it before handing a link to the browser: if the
* browser will not prerender it, the normal SPA prefetch/navigation path has
* to keep working.
*/
function isSpeculationSuppressed(anchor) {
	const rel = anchor.getAttribute("rel");
	if (rel && rel.split(/\s+/).some((token) => token.toLowerCase() === "nofollow")) return true;
	if (anchor.getAttribute("data-pracht-speculate") === "on") return false;
	return anchor.closest(`[${SPECULATE_ATTRIBUTE}="off"]`) !== null;
}
const DEFAULT_EAGERNESS = {
	prefetch: "moderate",
	prerender: "conservative"
};
const URL_PATTERN_STATIC_SEGMENT_CHARS_RE = /[:+*?{}()[\]\\]/g;
function normalizeSpeculation(option) {
	if (!option) return null;
	if (typeof option === "string") return { mode: option };
	return option;
}
function supportsSpeculationRules() {
	return typeof HTMLScriptElement !== "undefined" && typeof HTMLScriptElement.supports === "function" && HTMLScriptElement.supports("speculationrules");
}
const appRulesCache = /* @__PURE__ */ new WeakMap();
/**
* Returns the cached speculation rules document for a resolved app, computing
* it on first access. Routes are static per resolved app so the result is
* stable for the lifetime of the app object.
*/
function getAppSpeculationRules(app) {
	let cached = appRulesCache.get(app);
	if (cached === void 0) {
		cached = buildSpeculationRules(app.routes);
		appRulesCache.set(app, cached);
	}
	return cached;
}
function buildSpeculationRules(routes) {
	const buckets = /* @__PURE__ */ new Map();
	for (const route of routes) {
		const config = normalizeSpeculation(route.speculation);
		if (!config) continue;
		const eagerness = config.eagerness ?? DEFAULT_EAGERNESS[config.mode];
		const pattern = segmentsToHrefMatch(route.segments);
		if (!pattern) continue;
		const key = `${config.mode}:${eagerness}`;
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = {
				mode: config.mode,
				eagerness,
				patterns: []
			};
			buckets.set(key, bucket);
		}
		if (!bucket.patterns.includes(pattern)) bucket.patterns.push(pattern);
	}
	if (buckets.size === 0) return null;
	const doc = {};
	for (const { mode, eagerness, patterns } of buckets.values()) (doc[mode] ?? (doc[mode] = [])).push({
		source: "document",
		where: { and: [{ href_matches: patterns }, { not: { selector_matches: [...SPECULATION_EXCLUSION_SELECTORS] } }] },
		eagerness
	});
	return doc;
}
/**
* Convert pracht route segments to a URLPattern string suitable for
* `href_matches`. URLPattern supports `:name` and `*` natively, so this is
* mostly a 1:1 translation.
*
* The rules are matched by the browser against real document hrefs, so the
* pattern carries the deploy base — route segments do not.
*/
function segmentsToHrefMatch(segments) {
	const base = escapeStaticSegmentForUrlPattern(PRACHT_BASE);
	if (segments.length === 0) return base;
	return base + segments.map((segment) => {
		if (segment.type === "static") return escapeStaticSegmentForUrlPattern(segment.value);
		if (segment.type === "param") return `:${segment.name}`;
		return "*";
	}).join("/");
}
function escapeStaticSegmentForUrlPattern(segment) {
	return segment.replace(URL_PATTERN_STATIC_SEGMENT_CHARS_RE, "\\$&");
}
//#endregion
export { getAppSpeculationRules, isSpeculationSuppressed, normalizeSpeculation, supportsSpeculationRules };
