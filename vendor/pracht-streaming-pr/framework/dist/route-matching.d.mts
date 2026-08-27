import { HrefArgs, HrefRouteDefinition, RouteId, RouteParams, RouteSegment } from "./types.mjs";

//#region src/route-matching.d.ts
/** Match one declared route pattern against a concrete pathname. */
declare function matchRoutePath(pattern: string, pathname: string): RouteParams | null;
/** Whether a declared route pattern contains a parameter or catch-all segment. */
declare function routePathIsDynamic(pattern: string): boolean;
declare function buildPathFromSegments(segments: readonly RouteSegment[], params: RouteParams): string;
declare function buildHref<TRoute extends RouteId>(routes: readonly HrefRouteDefinition[], routeId: TRoute, ...args: HrefArgs<TRoute>): string;
//#endregion
export { buildHref, buildPathFromSegments, matchRoutePath, routePathIsDynamic };