//#region src/base.ts
/**
* Vite `base` support — deploying an app under a sub-path
* (`https://user.github.io/my-project/`, an S3 key prefix, a reverse proxy
* mount point) rather than at an origin root.
*
* The framework keeps two kinds of path:
*
* - **Route paths** (`/about`, `/blog/:slug`) — what the manifest declares and
*   what route matching and prerender output are keyed by. Never contain the
*   base.
* - **URL paths** (`/my-project/about`) — what the browser shows, requests, and
*   what `useLocation()` reports. Always contain the base.
*
* `withBase()` converts the first into the second (hrefs, fetch URLs, preload
* URLs) and `stripBase()` converts back (route matching). Everything else is
* unchanged, and with the default base of `/` both are the identity function,
* so no adapter pays for a feature it does not use.
*/
/**
* Vite defines `import.meta.env.BASE_URL` in client *and* SSR bundles, so both
* the browser runtime and the prerendered server bundle see the configured
* base without extra plumbing. Under plain Node — the CLI, unit tests — it is
* undefined and the base is the origin root.
*/
function normalizeBase(raw) {
	if (typeof raw !== "string" || raw === "" || raw === "./" || raw === ".") return "/";
	if (raw.includes("://") || raw.startsWith("//")) return "/";
	const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
	return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}
/** The configured base, normalized to leading and trailing slashes (`"/"` by default). */
const PRACHT_BASE = normalizeBase(import.meta.env?.BASE_URL);
/** True when the app is deployed under a sub-path. */
const HAS_BASE = PRACHT_BASE !== "/";
/** Route path → URL path. Leaves relative and absolute URLs alone. */
function withBase(path) {
	if (!HAS_BASE || !path.startsWith("/") || path.startsWith("//")) return path;
	return `${PRACHT_BASE}${path.slice(1)}`;
}
/**
* URL path → route path, or `null` when the URL is outside the base.
*
* `null` means "not this app": the client router hands such a link back to the
* browser instead of trying to match it.
*/
function stripBase(pathname) {
	if (!HAS_BASE) return pathname;
	const baseSegments = PRACHT_BASE.slice(1, -1).split("/");
	const pathSegments = pathname.startsWith("/") ? pathname.slice(1).split("/") : null;
	if (!pathSegments || pathSegments.length < baseSegments.length) return null;
	for (let index = 0; index < baseSegments.length; index += 1) {
		const baseSegment = canonicalizeBaseSegment(baseSegments[index]);
		const pathSegment = canonicalizeBaseSegment(pathSegments[index]);
		if (baseSegment === null || pathSegment === null || baseSegment !== pathSegment) return null;
	}
	const remaining = pathSegments.slice(baseSegments.length);
	return remaining.length === 0 ? "/" : `/${remaining.join("/")}`;
}
/**
* Return the canonical trailing-slash URL for a bare deploy base.
*
* The route matcher intentionally accepts both `/app` and `/app/` as the root
* route. Documents must still redirect to the latter so their relative links
* and assets resolve inside the deploy base rather than at the origin root.
*
* @internal
*/
function resolveBaseRedirectLocation(pathname, search = "") {
	if (!HAS_BASE || pathname.endsWith("/") || stripBase(pathname) !== "/") return null;
	return `${PRACHT_BASE}${search}`;
}
function canonicalizeBaseSegment(segment) {
	try {
		const decoded = decodeURIComponent(segment);
		if (decoded === "." || decoded === "..") return null;
		for (const character of decoded) {
			const codePoint = character.codePointAt(0);
			if (character === "/" || character === "\\" || codePoint === 0 || codePoint !== void 0 && (codePoint <= 31 || codePoint === 127)) return null;
		}
		return encodeURIComponent(decoded);
	} catch {
		return null;
	}
}
/**
* `stripBase()` for callers that must always produce a route path: synthetic
* build-time requests carry no base, and a serverful host may mount the app
* under the base without rewriting the path it forwards.
*/
function stripBaseLenient(pathname) {
	return stripBase(pathname) ?? pathname;
}
/** @internal Restore a trusted proxy-stripped pathname before app code sees the Request. */
function restoreBasePathInRequest(request) {
	if (!HAS_BASE) return request;
	const url = new URL(request.url);
	url.pathname = withBase(url.pathname);
	return new Request(url, request);
}
//#endregion
export { PRACHT_BASE, resolveBaseRedirectLocation, restoreBasePathInRequest, stripBase, stripBaseLenient, withBase };
