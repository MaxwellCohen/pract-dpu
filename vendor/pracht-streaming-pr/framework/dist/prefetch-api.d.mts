import { RouteId, RouteTarget } from "./types.mjs";
//#region src/prefetch-api.d.ts
interface PrefetchFn {
  (to: string): Promise<void>;
  <TRoute extends RouteId>(to: RouteTarget<TRoute>): Promise<void>;
}
/**
 * Imperatively prefetch a route: warms the route/shell module chunks and
 * caches the route-state JSON in the shared prefetch cache. Accepts an href
 * string or a typed route target (`{ route, params, search }`).
 *
 * Available once the client router has initialized; a no-op during SSR,
 * before hydration, and for URLs that do not match a client route.
 */
declare const prefetch: PrefetchFn;
//#endregion
export { PrefetchFn, prefetch };