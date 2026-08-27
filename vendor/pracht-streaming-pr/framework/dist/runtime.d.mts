import { CapabilityAuditHook, ModuleRegistry, PrachtApp, ResolvedApiRoute, ResolvedPrachtApp } from "./types.mjs";
import { Navigation, NavigationLocation } from "./navigation-state.mjs";
import { PrachtRuntimeDiagnosticPhase, PrachtRuntimeDiagnostics, RouteErrorContext, SerializedRouteError } from "./runtime-errors.mjs";
import { PrachtHydrationState, PrachtRuntimeProvider, StartAppOptions, readHydrationState, startApp } from "./runtime-context.mjs";
import { Form, FormProps, Link, LinkHrefGuidance, LinkProps, Location, ReadonlyURLSearchParams, useLocation, useNavigation, useParams, useRevalidate, useRouteData, useSearchParams } from "./runtime-hooks.mjs";
import { RouteStateResult, fetchPrachtRouteState, parseSafeNavigationUrl } from "./runtime-client-fetch.mjs";
import { PrachtPhaseTimings, formatServerTimingHeader } from "./runtime-timing.mjs";
import { applyDefaultSecurityHeaders, isProtocolSwitchResponse, preventHeuristicCaching } from "./runtime-headers.mjs";

//#region src/runtime.d.ts
interface HandlePrachtRequestOptions<TContext = unknown> {
  /**
   * Authoring-shaped or already-resolved app. Generated server entries pass
   * the resolved one, which is also the only shape that can carry
   * `hrefRoutes`.
   */
  app: PrachtApp | ResolvedPrachtApp;
  request: Request;
  /**
   * Set when a trusted upstream removed Vite's deploy base from the request
   * pathname before forwarding it. This is explicit because a base-free route
   * may itself begin with the same segments as the base, making prefix-based
   * inference ambiguous.
   */
  basePathStripped?: boolean;
  context?: TContext;
  registry?: ModuleRegistry;
  /** Expose raw server error details in rendered HTML and route-state JSON. */
  debugErrors?: boolean;
  clientEntryUrl?: string;
  /**
   * URL of the islands bootstrap script injected on `hydration: "islands"`
   * routes. Defaults to the URL registered by the generated server module
   * via `setIslandsClientEntryUrl()`.
   */
  islandsEntryUrl?: string;
  /**
   * Emit the islands bootstrap on islands-mode responses even when the render
   * captured no island components. Generated entries enable this when the
   * bootstrap owns another page-level runtime projection such as WebMCP.
   */
  islandsBootstrapRequired?: boolean;
  /** Per-source-file CSS map produced by the vite plugin. */
  cssManifest?: Record<string, string[]>;
  /** Per-source-file JS chunk map produced by the vite plugin for modulepreload hints. */
  jsManifest?: Record<string, string[]>;
  apiRoutes?: ResolvedApiRoute[];
  /**
   * Dev-only phase-timing collector. When provided, the runtime records
   * middleware/loader/render durations (ms) onto it so callers can emit a
   * `Server-Timing` header. Leave unset in production — no timing work runs.
   */
  timings?: PrachtPhaseTimings;
  /**
   * Structured audit callback invoked for every capability dispatch
   * (principal/agent, capability, effect, outcome, duration). Custom server
   * entries can pass it here; application code can alternatively register a
   * hook via `setCapabilityAuditHook()` from any server-only module.
   */
  onCapabilityAudit?: CapabilityAuditHook;
  /**
   * Called with the raw error whenever a page render fails, before it is
   * normalized into a response. The response body deliberately hides server
   * error details outside `debugErrors`, which leaves a build-time caller
   * (prerendering, static export) with a bare status and no cause. Prerender
   * passes this so a failing SSG page can name what actually threw.
   */
  onRouteError?: (error: unknown, requestPath: string, context?: RouteErrorContext) => void;
}
declare function handlePrachtRequest<TContext>(options: HandlePrachtRequestOptions<TContext>): Promise<Response>;
/**
 * Canonicalize a document request for a bare deploy base before an adapter's
 * static-file fast path can serve it as the root route.
 *
 * @internal
 */
declare function createBaseRedirectResponse(request: Request): Response | null;
//#endregion
export { HandlePrachtRequestOptions, createBaseRedirectResponse, handlePrachtRequest };