//#region src/dev-404.d.ts
/**
 * Self-contained 404 page for pracht dev mode.
 *
 * Returns a standalone HTML document with inline styles and scripts.
 * Not a Preact component — rendered by the dev middleware when a request
 * matches no page route and no API route. Loaded exclusively through the
 * dev server (`@pracht/core/dev-404`) and never reachable from production
 * code paths.
 */
interface DevNotFoundRoute {
  path: string;
  render?: string | null;
}
interface DevNotFoundApiRoute {
  path: string;
  methods?: string[];
}
interface DevNotFoundOptions {
  requestedPath: string;
  routes: DevNotFoundRoute[];
  apiRoutes?: DevNotFoundApiRoute[];
  /** Vite deploy base used for navigable links. */
  base?: string;
}
declare function buildDevNotFoundHtml(options: DevNotFoundOptions): string;
//#endregion
export { DevNotFoundApiRoute, DevNotFoundOptions, DevNotFoundRoute, buildDevNotFoundHtml };