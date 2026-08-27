import { FontHeadFragments } from "./font.mjs";
import { SerializedRouteError } from "./runtime-errors.mjs";

//#region src/runtime-client-fetch.d.ts
type RouteStateResult = {
  type: "data";
  data: unknown;
  fontHead?: FontHeadFragments;
} | {
  type: "redirect";
  location: string;
} | {
  type: "error";
  error: SerializedRouteError;
  fontHead?: FontHeadFragments;
};
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
declare function parseSafeNavigationUrl(location: string, base: string | URL): URL | null;
declare function fetchPrachtRouteState(url: string, options?: {
  cache?: RequestCache;
  signal?: AbortSignal;
  useDataParam?: boolean;
}): Promise<RouteStateResult>;
//#endregion
export { RouteStateResult, fetchPrachtRouteState, parseSafeNavigationUrl };