import { normalizeRoutePath } from "./route-matching.mjs";
import { appendVaryHeader, applyDefaultSecurityHeaders } from "./runtime-headers.mjs";
//#region src/runtime-negotiation.ts
const MARKDOWN_MEDIA_TYPE = "text/markdown";
/** Whether a route exposes Markdown through metadata or a raw module export. */
function hasMarkdownRepresentation(route, routeModule) {
	return route.markdown === true || typeof routeModule?.markdown === "string";
}
function parseAccept(header) {
	if (!header) return [];
	const entries = [];
	for (const raw of header.split(",")) {
		const parts = raw.trim().split(";");
		const type = parts.shift()?.trim().toLowerCase();
		if (!type) continue;
		let quality = 1;
		for (const param of parts) {
			const [key, value] = param.split("=").map((p) => p.trim());
			if (key === "q" && value != null) {
				const parsed = Number.parseFloat(value);
				if (!Number.isNaN(parsed)) quality = parsed;
			}
		}
		entries.push({
			type,
			quality
		});
	}
	return entries;
}
function prefersMarkdown(accept) {
	const entries = parseAccept(accept);
	if (!entries.length) return false;
	const md = entries.find((e) => e.type === MARKDOWN_MEDIA_TYPE);
	if (!md || md.quality === 0) return false;
	const html = entries.find((e) => e.type === "text/html");
	if (!html) return true;
	return md.quality >= html.quality;
}
/** Whether the build recorded a raw Markdown representation for this route. */
function routeSupportsMarkdown(markdownManifest, pathname) {
	const normalized = normalizeRoutePath(pathname);
	const withoutIndex = normalized.replace(/\/index\.html$/, "") || "/";
	return Boolean(markdownManifest[normalized] ?? markdownManifest[withoutIndex]);
}
function markdownResponse(source, initHeaders, status = 200) {
	const headers = new Headers(initHeaders);
	headers.set("content-type", "text/markdown; charset=utf-8");
	appendVaryHeader(headers, "Accept");
	applyDefaultSecurityHeaders(headers);
	return new Response(source, {
		status,
		headers
	});
}
//#endregion
export { MARKDOWN_MEDIA_TYPE, hasMarkdownRepresentation, markdownResponse, prefersMarkdown, routeSupportsMarkdown };
