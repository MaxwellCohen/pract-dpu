//#region src/base.d.ts
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
/** The configured base, normalized to leading and trailing slashes (`"/"` by default). */
declare const PRACHT_BASE: string;
/** Route path → URL path. Leaves relative and absolute URLs alone. */
declare function withBase(path: string): string;
/**
 * URL path → route path, or `null` when the URL is outside the base.
 *
 * `null` means "not this app": the client router hands such a link back to the
 * browser instead of trying to match it.
 */
declare function stripBase(pathname: string): string | null;
/** @internal Restore a trusted proxy-stripped pathname before app code sees the Request. */
declare function restoreBasePathInRequest(request: Request): Request;
//#endregion
export { PRACHT_BASE, restoreBasePathInRequest, stripBase, withBase };