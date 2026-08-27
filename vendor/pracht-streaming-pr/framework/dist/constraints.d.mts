import { RenderMode } from "./types.mjs";

//#region src/constraints.d.ts
interface RequireMiddlewareConstraint {
  kind: "require-middleware";
  pattern: string;
  middleware: string[];
}
interface RequireShellConstraint {
  kind: "require-shell";
  pattern: string;
  shells: string[];
}
interface RequireRenderModeConstraint {
  kind: "require-render-mode";
  pattern: string;
  modes: RenderMode[];
}
interface ForbidRenderModeConstraint {
  kind: "forbid-render-mode";
  pattern: string;
  modes: RenderMode[];
}
interface RequireHeadConstraint {
  kind: "require-head";
  pattern: string;
}
type RouteConstraint = RequireMiddlewareConstraint | RequireShellConstraint | RequireRenderModeConstraint | ForbidRenderModeConstraint | RequireHeadConstraint;
/** Every route matching `pattern` must include all of the given middleware names. */
declare function requireMiddleware(pattern: string, ...middleware: string[]): RequireMiddlewareConstraint;
/** Every route matching `pattern` must use one of the given shells. */
declare function requireShell(pattern: string, ...shells: string[]): RequireShellConstraint;
/** Every route matching `pattern` must use one of the given render modes. */
declare function requireRenderMode(pattern: string, ...modes: RenderMode[]): RequireRenderModeConstraint;
/** No route matching `pattern` may use any of the given render modes. */
declare function forbidRenderMode(pattern: string, ...modes: RenderMode[]): ForbidRenderModeConstraint;
/** Every route matching `pattern` must export `head()` (directly or via its shell). */
declare function requireHead(pattern: string): RequireHeadConstraint;
/**
 * Match a route path against a constraint pattern. Segment-wise: `*` matches
 * exactly one segment, a trailing `**` matches zero or more segments, other
 * segments compare literally against the declared path (so `/blog/*` matches
 * `/blog/:slug`).
 */
declare function matchRoutePattern(pattern: string, routePath: string): boolean;
/**
 * The route shape constraint evaluation needs. Matches both the framework's
 * `ResolvedRoute` and the serialized `AppGraphRoute` the CLI works with.
 */
interface ConstraintRoute {
  path: string;
  middleware: string[];
  render?: string | null;
  shell?: string | null;
}
interface ConstraintViolation {
  constraint: RouteConstraint;
  message: string;
  routePath: string;
}
interface EvaluateConstraintsOptions {
  /**
   * Whether the route (or its shell) exports `head()`. Required to evaluate
   * `requireHead` constraints — it needs module source access the evaluator
   * doesn't have. Returning `undefined` skips the route.
   */
  routeHasHead?: (route: ConstraintRoute) => boolean | undefined;
}
declare function evaluateConstraints(routes: readonly ConstraintRoute[], constraints: readonly RouteConstraint[], options?: EvaluateConstraintsOptions): ConstraintViolation[];
//#endregion
export { ConstraintRoute, ConstraintViolation, EvaluateConstraintsOptions, ForbidRenderModeConstraint, RequireHeadConstraint, RequireMiddlewareConstraint, RequireRenderModeConstraint, RequireShellConstraint, RouteConstraint, evaluateConstraints, forbidRenderMode, matchRoutePattern, requireHead, requireMiddleware, requireRenderMode, requireShell };