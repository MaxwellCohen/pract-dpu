//#region src/font.ts
const GENERIC_FAMILIES = new Set([
	"cursive",
	"emoji",
	"fangsong",
	"fantasy",
	"math",
	"monospace",
	"sans-serif",
	"serif",
	"system-ui",
	"ui-monospace",
	"ui-rounded",
	"ui-sans-serif",
	"ui-serif"
]);
const FONT_DISPLAY_VALUES = new Set([
	"auto",
	"block",
	"swap",
	"fallback",
	"optional"
]);
const FONT_WEIGHT_RE = /^(auto|normal|bold|(?:\d+(?:\.\d+)?|\.\d+)(?: +(?:\d+(?:\.\d+)?|\.\d+))?)$/;
const FONT_STYLE_RE = /^(auto|normal|italic|left|right|oblique(?: +([+-]?(?:\d+(?:\.\d+)?|\.\d+))deg(?: +([+-]?(?:\d+(?:\.\d+)?|\.\d+))deg)?)?)$/;
const METRIC_OVERRIDE_RE = /^(normal|\d{1,4}(\.\d+)?%)$/;
const SRC_FORMAT_RE = /^[a-z0-9-]{1,32}$/i;
const PRELOAD_MIME_TYPES = {
	otf: "font/otf",
	opentype: "font/otf",
	"opentype-variations": "font/otf",
	truetype: "font/ttf",
	"truetype-variations": "font/ttf",
	ttf: "font/ttf",
	woff: "font/woff",
	"woff-variations": "font/woff",
	woff2: "font/woff2",
	"woff2-variations": "font/woff2"
};
function isWoff2Format(format) {
	return format === "woff2" || format === "woff2-variations";
}
/**
* Escape a value for interpolation inside a double-quoted CSS string. Escapes
* the CSS string metacharacters (`"`, `\`) and hex-escapes control characters
* plus `<`, `>`, and `&` so the output can never terminate the surrounding
* `<style>` element or smuggle markup, even after CSS unescaping.
*/
function escapeCssString(value) {
	let out = "";
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		if (ch === "\"" || ch === "\\") out += `\\${ch}`;
		else if (code < 32 || code === 127 || ch === "<" || ch === ">" || ch === "&") out += `\\${code.toString(16)} `;
		else out += ch;
	}
	return out;
}
function fail(family, message) {
	throw new Error(`[pracht] defineFont(${JSON.stringify(family)}): ${message}`);
}
const UNICODE_MAX_CODE_POINT = 1114111;
/**
* One `<urange>` token per css-syntax-3: a single code point (`U+26`), an
* interval (`U+0-7F`, start <= end), or a trailing-wildcard form (`U+4??`).
* Wildcards cannot be combined with an interval, and code points cannot
* exceed U+10FFFF — a browser drops the whole descriptor for such tokens,
* silently widening the face to every code point.
*/
function isValidUnicodeRangeToken(token) {
	if (!/^[Uu]\+/.test(token)) return false;
	const body = token.slice(2);
	if (body.length === 0 || body.length > 13) return false;
	const parts = body.split("-");
	if (parts.length === 2) {
		if (!/^[0-9A-Fa-f]{1,6}$/.test(parts[0]) || !/^[0-9A-Fa-f]{1,6}$/.test(parts[1])) return false;
		const start = Number.parseInt(parts[0], 16);
		const end = Number.parseInt(parts[1], 16);
		return start <= end && end <= UNICODE_MAX_CODE_POINT;
	}
	if (parts.length !== 1) return false;
	if (body.length > 6) return false;
	if (body.includes("?")) return /^[0-9A-Fa-f]*\?+$/.test(body) && Number.parseInt(body.replaceAll("?", "F"), 16) <= UNICODE_MAX_CODE_POINT;
	if (!/^[0-9A-Fa-f]{1,6}$/.test(body)) return false;
	return Number.parseInt(body, 16) <= UNICODE_MAX_CODE_POINT;
}
function validateUnicodeRange(family, value) {
	const tokens = value.split(",").map((token) => token.trim());
	if (tokens.length === 0 || tokens.some((token) => !isValidUnicodeRangeToken(token))) fail(family, `invalid unicodeRange ${JSON.stringify(value)}`);
	return tokens.join(", ");
}
/**
* `font-weight` descriptor values must sit in the CSS range [1, 1000], and a
* variable range must be ascending. Out-of-range values are not a security
* problem (the grammar is already digit-only) but browsers drop the invalid
* descriptor silently, so the face falls back to `font-weight: normal` and
* matches the wrong styles.
*/
function validateWeight(family, value) {
	if (!FONT_WEIGHT_RE.test(value)) fail(family, `invalid weight ${JSON.stringify(value)}`);
	if (value !== "auto" && value !== "normal" && value !== "bold") {
		const parts = value.split(/ +/).map(Number);
		for (const part of parts) if (part < 1 || part > 1e3) fail(family, `invalid weight ${JSON.stringify(value)} — values must be between 1 and 1000`);
		if (parts.length === 2 && parts[0] > parts[1]) fail(family, `invalid weight range ${JSON.stringify(value)} — must be ascending`);
	}
	return value;
}
function validateStyle(family, value) {
	const match = FONT_STYLE_RE.exec(value);
	if (!match) fail(family, `invalid style ${JSON.stringify(value)}`);
	const angles = match.slice(2).filter((angle) => angle !== void 0).map(Number);
	for (const angle of angles) if (angle < -90 || angle > 90) fail(family, `invalid style ${JSON.stringify(value)} — angles must be between -90deg and 90deg`);
	if (angles.length === 2 && angles[0] > angles[1]) fail(family, `invalid style range ${JSON.stringify(value)} — must be ascending`);
	return value;
}
function validateMetric(family, name, value, options) {
	const normalized = value.trim();
	if (!METRIC_OVERRIDE_RE.test(normalized) || normalized === "normal" && !options?.allowNormal) fail(family, `invalid ${name} ${JSON.stringify(value)} — expected a percentage like "105%"`);
	return normalized;
}
function hasWhitespaceOrControlCharacters(value) {
	if (/\s/.test(value)) return true;
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		if (code < 32 || code === 127) return true;
	}
	return false;
}
function resolveSources(family, src) {
	const list = typeof src === "string" ? [src] : src;
	if (!Array.isArray(list) || list.length === 0) fail(family, "src must be a public path or a non-empty array of variants");
	const sources = list.map((entry) => {
		const url = typeof entry === "string" ? entry : entry.url;
		const format = typeof entry === "string" ? "woff2" : entry.format ?? "woff2";
		if (typeof url !== "string" || url.trim() === "") fail(family, "src entries need a non-empty url");
		if (hasWhitespaceOrControlCharacters(url)) fail(family, `src url ${JSON.stringify(url)} contains whitespace or control characters`);
		if (!SRC_FORMAT_RE.test(format)) fail(family, `invalid src format ${JSON.stringify(format)}`);
		return {
			url,
			format: format.toLowerCase()
		};
	});
	return [...sources.filter((source) => isWoff2Format(source.format)), ...sources.filter((source) => !isWoff2Format(source.format))];
}
/**
* Vendor keywords like `-apple-system` stop working when quoted (a quoted
* value is matched as a family *name*, not the keyword). The pattern only
* admits identifier characters, so emitting them unquoted stays injection-safe.
*/
const VENDOR_FONT_KEYWORD_RE = /^-[a-z][a-z0-9-]*$/i;
function quoteFamily(name) {
	if (GENERIC_FAMILIES.has(name.toLowerCase()) || VENDOR_FONT_KEYWORD_RE.test(name)) return name;
	return `"${escapeCssString(name)}"`;
}
function hashString(input) {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) hash = (hash << 5) + hash + input.charCodeAt(i) >>> 0;
	return hash.toString(36);
}
/**
* Define a self-hosted font. Register the returned object in a shell or route
* `head()` via the `fonts` array; use `font.className` / `font.style` /
* `font.fontFamily` in components:
*
* ```ts
* // src/fonts.ts
* export const inter = defineFont({
*   family: "Inter",
*   src: "/fonts/inter-latin.woff2",
*   weight: "100 900",
*   fallbacks: ["Arial", "sans-serif"],
*   sizeAdjust: "107%",
* });
*
* // src/shells/public.tsx
* export function head() {
*   return { title: "My Site", fonts: [inter] };
* }
* ```
*
* The head renderer expands each font into `<link rel="preload" as="font"
* type="font/woff2" crossorigin>` plus one inline `<style>` with the
* `@font-face` rules, deduped across shell and route contributions.
*/
function defineFont(options) {
	const family = options.family;
	if (typeof family !== "string" || family.trim() === "") throw new Error("[pracht] defineFont: family must be a non-empty string");
	const sources = resolveSources(family, options.src);
	const display = options.display ?? "swap";
	if (!FONT_DISPLAY_VALUES.has(display)) fail(family, `invalid display ${JSON.stringify(display)}`);
	const weight = options.weight != null ? validateWeight(family, String(options.weight).trim()) : void 0;
	const style = options.style !== void 0 ? validateStyle(family, options.style.trim()) : void 0;
	const unicodeRange = options.unicodeRange !== void 0 ? validateUnicodeRange(family, options.unicodeRange) : void 0;
	const fallbacks = (options.fallbacks ?? []).map((fallback) => typeof fallback === "string" ? fallback.trim() : fallback);
	for (const fallback of fallbacks) if (typeof fallback !== "string" || fallback.trim() === "") fail(family, "fallbacks must be non-empty family names");
	const metricEntries = [];
	if (options.sizeAdjust !== void 0) metricEntries.push(["size-adjust", validateMetric(family, "sizeAdjust", options.sizeAdjust)]);
	if (options.ascentOverride !== void 0) metricEntries.push(["ascent-override", validateMetric(family, "ascentOverride", options.ascentOverride, { allowNormal: true })]);
	if (options.descentOverride !== void 0) metricEntries.push(["descent-override", validateMetric(family, "descentOverride", options.descentOverride, { allowNormal: true })]);
	if (options.lineGapOverride !== void 0) metricEntries.push(["line-gap-override", validateMetric(family, "lineGapOverride", options.lineGapOverride, { allowNormal: true })]);
	const metricsFallback = options.metricsFallback?.trim();
	if (metricsFallback !== void 0 && metricsFallback === "") fail(family, "metricsFallback must be a non-empty font name");
	if (metricsFallback !== void 0 && (GENERIC_FAMILIES.has(metricsFallback.toLowerCase()) || VENDOR_FONT_KEYWORD_RE.test(metricsFallback))) fail(family, "metricsFallback must name a locally installed font, not a CSS keyword");
	const localFallback = metricsFallback ?? fallbacks.find((name) => !GENERIC_FAMILIES.has(name.toLowerCase()) && !VENDOR_FONT_KEYWORD_RE.test(name));
	const hasFallbackFace = metricEntries.length > 0 && localFallback !== void 0;
	const fallbackFamilyName = hasFallbackFace ? `${family} Fallback ${hashString(localFallback)}` : `${family} Fallback`;
	const fontFamily = [
		`"${escapeCssString(family)}"`,
		...hasFallbackFace ? [quoteFamily(fallbackFamilyName)] : [],
		...fallbacks.map(quoteFamily)
	].join(", ");
	const srcValue = sources.map((source) => `url("${escapeCssString(source.url)}") format("${source.format}")`).join(", ");
	const faceCss = `@font-face{${[
		`font-family:"${escapeCssString(family)}"`,
		`src:${srcValue}`,
		...weight !== void 0 ? [`font-weight:${weight}`] : [],
		...style !== void 0 ? [`font-style:${style}`] : [],
		`font-display:${display}`,
		...unicodeRange !== void 0 ? [`unicode-range:${unicodeRange}`] : []
	].join(";")}}`;
	const fallbackFaceCss = hasFallbackFace ? `@font-face{font-family:"${escapeCssString(fallbackFamilyName)}";src:local("${escapeCssString(localFallback)}");${[
		...weight !== void 0 ? [`font-weight:${weight}`] : [],
		...style !== void 0 ? [`font-style:${style}`] : [],
		...unicodeRange !== void 0 ? [`unicode-range:${unicodeRange}`] : [],
		...metricEntries.map(([descriptor, value]) => `${descriptor}:${value}`)
	].join(";")}}` : void 0;
	const className = `pracht-font-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom"}-${hashString(fontFamily)}`;
	const classCss = `.${className}{font-family:${fontFamily}}`;
	const preload = options.preload ?? true;
	const preloadLinks = [sources[0]].map((source) => ({
		rel: "preload",
		as: "font",
		type: PRELOAD_MIME_TYPES[source.format] ?? `font/${source.format}`,
		href: source.url,
		crossorigin: "anonymous"
	}));
	return {
		family,
		fontFamily,
		className,
		style: { fontFamily },
		sources,
		preload,
		preloadLinks,
		faceCss,
		fallbackFaceCss,
		classCss
	};
}
/**
* Collapse the merged `fonts` head array into deduped preload links and one
* CSS payload. The same font registered by both a shell and a route (or by
* several routes sharing a shell) emits exactly one preload and one
* `@font-face` block.
*/
function collectFontHeadFragments(fonts) {
	const preloadLinks = [];
	const seenPreloadHrefs = /* @__PURE__ */ new Set();
	const faceBlocks = [];
	const seenFaceBlocks = /* @__PURE__ */ new Set();
	const fallbackBlocks = [];
	const seenFallbackBlocks = /* @__PURE__ */ new Set();
	const classBlocks = [];
	const seenClassNames = /* @__PURE__ */ new Set();
	const isSafeCssBlock = (css) => !css.includes("<");
	for (const font of fonts) {
		if (font == null || typeof font !== "object" || typeof font.faceCss !== "string") continue;
		if (!seenFaceBlocks.has(font.faceCss) && isSafeCssBlock(font.faceCss)) {
			seenFaceBlocks.add(font.faceCss);
			faceBlocks.push(font.faceCss);
		}
		if (font.preload) for (const link of font.preloadLinks) {
			const href = link.href;
			if (typeof href !== "string" || seenPreloadHrefs.has(href)) continue;
			seenPreloadHrefs.add(href);
			preloadLinks.push(link);
		}
		if (font.fallbackFaceCss && !seenFallbackBlocks.has(font.fallbackFaceCss) && isSafeCssBlock(font.fallbackFaceCss)) {
			seenFallbackBlocks.add(font.fallbackFaceCss);
			fallbackBlocks.push(font.fallbackFaceCss);
		}
		if (typeof font.classCss === "string" && !seenClassNames.has(font.className) && isSafeCssBlock(font.classCss)) {
			seenClassNames.add(font.className);
			classBlocks.push(font.classCss);
		}
	}
	return {
		preloadLinks,
		css: [
			...faceBlocks,
			...fallbackBlocks,
			...classBlocks
		].join("\n")
	};
}
//#endregion
export { collectFontHeadFragments, defineFont };
