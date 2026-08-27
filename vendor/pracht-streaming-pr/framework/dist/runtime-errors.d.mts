//#region src/runtime-errors.d.ts
type PrachtRuntimeDiagnosticPhase = "match" | "middleware" | "loader" | "action" | "render" | "api";
interface PrachtRuntimeDiagnostics {
  phase: PrachtRuntimeDiagnosticPhase;
  routeId?: string;
  routePath?: string;
  routeFile?: string;
  loaderFile?: string;
  shellFile?: string;
  middlewareFiles?: string[];
  status: number;
}
/**
 * Route metadata handed to `onRouteError` alongside the raw error.
 *
 * The response body deliberately hides these details outside `debugErrors`,
 * so a caller that owns the surrounding surface — prerendering, the dev
 * server's error overlay — would otherwise have to re-derive which route
 * failed, in which phase, and whether a declared boundary owns the response.
 * Unlike `PrachtRuntimeDiagnostics` it carries no status: the error has not
 * been normalized into a response yet.
 */
interface RouteErrorContext {
  phase: PrachtRuntimeDiagnosticPhase;
  /** Which declared ErrorBoundary will receive the failure, when present. */
  errorBoundary?: "route" | "shell";
  routeId?: string;
  routePath?: string;
  routeFile?: string;
  loaderFile?: string;
  shellFile?: string;
  middlewareFiles?: string[];
}
interface SerializedRouteError {
  message: string;
  name: string;
  status: number;
  diagnostics?: PrachtRuntimeDiagnostics;
}
//#endregion
export { PrachtRuntimeDiagnosticPhase, PrachtRuntimeDiagnostics, RouteErrorContext, SerializedRouteError };