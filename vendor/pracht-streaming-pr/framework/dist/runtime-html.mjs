import { HYDRATION_STATE_ELEMENT_ID } from "./runtime-constants.mjs";
import { collectFontHeadFragments } from "./font.mjs";
import { applyHeaders, applySecurityAndRouteHeaders } from "./runtime-headers.mjs";
import { escapeScriptChildren } from "./script-escape.mjs";
//#region src/runtime-html.ts
function escapeHtml(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function serializeJsonForHtml(value) {
	return escapeScriptText(JSON.stringify(value) ?? "null");
}
function escapeScriptText(value) {
	return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
const SAFE_ATTRIBUTE_NAME_RE = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const GLOBAL_HEAD_ATTRIBUTE_PREFIXES = ["data-", "aria-"];
const META_ATTRIBUTES = new Set([
	"charset",
	"content",
	"http-equiv",
	"itemprop",
	"media",
	"name",
	"property"
]);
const LINK_ATTRIBUTES = new Set([
	"as",
	"blocking",
	"color",
	"crossorigin",
	"disabled",
	"fetchpriority",
	"href",
	"hreflang",
	"imagesizes",
	"imagesrcset",
	"integrity",
	"media",
	"referrerpolicy",
	"rel",
	"sizes",
	"title",
	"type"
]);
const SCRIPT_ATTRIBUTES = new Set([
	"async",
	"blocking",
	"class",
	"crossorigin",
	"defer",
	"fetchpriority",
	"id",
	"integrity",
	"nomodule",
	"nonce",
	"referrerpolicy",
	"src",
	"type"
]);
function renderAttributes(attributes, allowedAttributes) {
	return Object.entries(attributes).filter(([key, value]) => isAllowedHeadAttribute(key, value, allowedAttributes)).map(([key, value]) => `${key}="${escapeHtml(value ?? "")}"`).join(" ");
}
function isAllowedHeadAttribute(key, value, allowedAttributes) {
	if (key === "children" || typeof value === "undefined" || !SAFE_ATTRIBUTE_NAME_RE.test(key)) return false;
	const normalized = key.toLowerCase();
	if (normalized.startsWith("on")) return false;
	return allowedAttributes.has(normalized) || GLOBAL_HEAD_ATTRIBUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
/**
* Assemble the document as three pieces so the streaming renderer can write
* them around a body it does not have yet.
*
* `buildHtmlDocument()` is the concatenation of all three with the body in the
* middle, so the buffered and streamed paths cannot drift apart.
*
* - `prefix` — through the opening `<div id="pracht-root">`
* - `afterShell` — closes that div and carries hydration state/bootstrap scripts
* - `suffix` — optional deferred client entry plus `</body></html>`, written once
*   the render is done
*/
function buildHtmlDocumentParts(options) {
	const { head, hydrationState, clientEntryUrl, clientEntryAsync = false, clientEntryAtEnd = false, inlineBootstrapScript, cssUrls = [], modulePreloadUrls = [], routeStatePreloadUrl, speculationRules } = options;
	const titleTag = head.title ? `<title>${escapeHtml(head.title)}</title>` : "";
	const metaTags = (head.meta ?? []).map((m) => renderAttributes(m, META_ATTRIBUTES)).filter(Boolean).map((attrs) => `<meta ${attrs}>`).join("\n    ");
	const linkTags = (head.link ?? []).map((l) => renderAttributes(l, LINK_ATTRIBUTES)).filter(Boolean).map((attrs) => `<link ${attrs}>`).join("\n    ");
	const fontFragments = head.fonts?.length ? collectFontHeadFragments(head.fonts) : void 0;
	const fontLinkTags = fontFragments ? fontFragments.preloadLinks.map((link) => renderAttributes(link, LINK_ATTRIBUTES)).filter(Boolean).map((attrs) => `<link data-pracht-font-preload ${attrs}>`).join("\n    ") : "";
	const fontStyleTag = fontFragments?.css || head.fontNonce ? `<style data-pracht-fonts${head.fontNonce ? ` nonce="${escapeHtml(head.fontNonce)}"` : ""}>${fontFragments?.css ?? ""}</style>` : "";
	const scriptTags = (head.script ?? []).map((script) => {
		const attrs = renderAttributes(script, SCRIPT_ATTRIBUTES);
		const children = script.children ? escapeScriptChildren(script.children, script.type) : "";
		return attrs ? `<script ${attrs}>${children}<\/script>` : `<script>${children}<\/script>`;
	}).join("\n    ");
	const cssTags = cssUrls.map((url) => `<link rel="stylesheet" href="${escapeHtml(url)}">`).join("\n    ");
	const modulePreloadTags = modulePreloadUrls.map((url) => `<link rel="modulepreload" href="${escapeHtml(url)}">`).join("\n    ");
	const routeStatePreloadTag = routeStatePreloadUrl ? `<link rel="preload" as="fetch" href="${escapeHtml(routeStatePreloadUrl)}" crossorigin="anonymous">` : "";
	const speculationRulesTag = speculationRules ? `<script type="speculationrules">${serializeJsonForHtml(speculationRules)}<\/script>` : "";
	const stateScript = hydrationState ? `<script id="${HYDRATION_STATE_ELEMENT_ID}" type="application/json">${serializeJsonForHtml(hydrationState)}<\/script>` : "";
	const bootstrapScript = inlineBootstrapScript ? `<script${inlineBootstrapScript.nonce ? ` nonce="${escapeHtml(inlineBootstrapScript.nonce)}"` : ""}>${escapeScriptChildren(inlineBootstrapScript.source)}<\/script>` : "";
	const entryScript = clientEntryUrl ? `<script type="module"${clientEntryAsync ? " async" : ""} src="${escapeHtml(clientEntryUrl)}"><\/script>` : "";
	const headLines = joinDocumentLines([
		"<meta charset=\"utf-8\">",
		titleTag,
		metaTags,
		linkTags,
		fontLinkTags,
		fontStyleTag,
		scriptTags,
		cssTags,
		modulePreloadTags,
		routeStatePreloadTag,
		speculationRulesTag
	], "    ");
	const trailingScripts = joinDocumentLines([
		stateScript,
		bootstrapScript,
		clientEntryAtEnd ? "" : entryScript
	], "    ");
	const suffixScripts = joinDocumentLines([clientEntryAtEnd ? entryScript : ""], "    ");
	return {
		prefix: `<!DOCTYPE html>
<html${head.lang ? ` lang="${escapeHtml(head.lang)}"` : ""}>
  <head>
${headLines}
  </head>
  <body>
    <div id="pracht-root">`,
		afterShell: `</div>${trailingScripts ? `\n${trailingScripts}` : ""}`,
		suffix: `${suffixScripts ? `\n${suffixScripts}` : ""}
  </body>
</html>`
	};
}
function buildHtmlDocument(options) {
	const { prefix, afterShell, suffix } = buildHtmlDocumentParts(options);
	return `${prefix}${options.body}${afterShell}${suffix}`;
}
function joinDocumentLines(parts, indent) {
	return parts.filter((part) => part !== "").map((part) => `${indent}${part}`).join("\n");
}
function htmlResponse(html, status = 200, initHeaders) {
	const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
	if (initHeaders) applyHeaders(headers, initHeaders);
	applySecurityAndRouteHeaders(headers, { isRouteStateRequest: false });
	return new Response(html, {
		status,
		headers
	});
}
//#endregion
export { buildHtmlDocument, buildHtmlDocumentParts, escapeHtml, escapeScriptText, htmlResponse };
