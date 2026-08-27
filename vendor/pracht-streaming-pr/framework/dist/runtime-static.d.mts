//#region src/runtime-static.d.ts
/**
 * URL prefix of the serialized route-state tree. It lives inside `_pracht/`,
 * which the build already reserves for framework metadata
 * (`_pracht/headers.json`, `_pracht/markdown.json`), so state files can never
 * collide with a prerendered route: routes are written as
 * `<path>/index.html`, never under `_pracht/`.
 */
declare const STATIC_STATE_PREFIX = "/_pracht/state";
/**
 * Map a request URL (path + optional query) to its static route-state file.
 *
 * The scheme uses opaque hexadecimal components for every URL segment and a
 * reserved `_state.json` leaf — `/` → `/_pracht/state/index.json`, while
 * `/blog/hello` maps to two encoded directories plus the leaf. Long encoded
 * segments are split across bounded continuation components, so otherwise
 * valid route params cannot exceed a filesystem's per-component name limit.
 * The `s-` (segment) / `c-` (continuation) markers keep the mapping injective,
 * including `/docs` versus `/docs/index.json`.
 *
 * The query string is dropped deliberately: static loader data was produced
 * at build time from the bare pathname, so every query variant of a URL maps
 * to the same payload (exactly what the build generated).
 *
 * HTML goes to the *decoded* path (`/posts/caf%C3%A9` →
 * `posts/café/index.html`) because hosts decode before the filesystem lookup.
 * State files canonicalize each segment to the encoding produced by
 * `encodeURIComponent()` before hex-encoding it. The build and client therefore
 * agree for raw Unicode, lowercase percent escapes, and escaped unreserved
 * characters that identify the same URL path. The resulting component names
 * are pure ASCII hex, so host decoding cannot affect them either way.
 */
declare function buildStaticRouteStateUrl(url: string): string;
//#endregion
export { STATIC_STATE_PREFIX, buildStaticRouteStateUrl };