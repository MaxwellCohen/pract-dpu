import { ApiRouteMatch, GroupDefinition, GroupMeta, ModuleRef, PrachtApp, PrachtAppConfig, ResolvedApiRoute, ResolvedPrachtApp, RouteConfig, RouteDefinition, RouteMatch, RouteMeta, RouteTreeNode, TimeRevalidatePolicy, WebhookRevalidatePolicy } from "./types.mjs";
import { buildHref, buildPathFromSegments, matchRoutePath, routePathIsDynamic } from "./route-matching.mjs";

//#region src/app.d.ts
declare function timeRevalidate(seconds: number): TimeRevalidatePolicy;
declare function webhookRevalidate(): WebhookRevalidatePolicy;
declare function route(path: string, file: ModuleRef, meta?: RouteMeta): RouteDefinition;
declare function route(path: string, config: RouteConfig): RouteDefinition;
declare function group(meta: GroupMeta, routes: RouteTreeNode[]): GroupDefinition;
declare function defineApp(config: PrachtAppConfig): PrachtApp;
declare function resolveApp(app: PrachtApp): ResolvedPrachtApp;
declare function matchAppRoute(app: PrachtApp | ResolvedPrachtApp, pathname: string): RouteMatch | undefined;
/**
 * Convert a list of file paths from `import.meta.glob` into resolved API routes.
 *
 * Example: `"/src/api/health.ts"` → path `/api/health`
 *          `"/src/api/users/[id].ts"` → path `/api/users/:id`
 *          `"/src/api/files/[...path].ts"` → path `/api/files/*`
 *          `"/src/api/index.ts"` → path `/api`
 */
declare function resolveApiRoutes(files: string[], apiDir?: string): ResolvedApiRoute[];
declare function matchApiRoute(apiRoutes: ResolvedApiRoute[], pathname: string): ApiRouteMatch | undefined;
//#endregion
export { defineApp, group, matchApiRoute, matchAppRoute, resolveApiRoutes, resolveApp, route, timeRevalidate, webhookRevalidate };