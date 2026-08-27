import { HeadMetadata, ModuleRegistry, PrachtApp, RouteRevalidate } from "./types.mjs";
import { SerializedRouteError } from "./runtime-errors.mjs";

//#region src/prerender.d.ts
interface PrerenderResult {
  path: string;
  html: string;
  headers?: Record<string, string>;
  /** Whether the route declares a Markdown representation. */
  markdown: boolean;
  /**
   * Serialized route-state JSON for the path — the exact body the live
   * `x-pracht-route-state-request` endpoint would answer with. Captured only
   * for `staticExport` builds, and only for full-hydration SSG routes whose
   * loader or head metadata needs a build-time payload during client navigation.
   */
  routeState?: string;
  /** Whether this page is a `render: "spa"` shell (staticExport builds only). */
  spa?: boolean;
}
interface ISGManifestEntry {
  revalidate: RouteRevalidate;
  generatedAt?: number;
}
interface PrerenderAppResult {
  pages: PrerenderResult[];
  isgManifest: Record<string, ISGManifestEntry>;
}
interface PrerenderAppOptions {
  app: PrachtApp;
  registry?: ModuleRegistry;
  clientEntryUrl?: string;
  islandsEntryUrl?: string;
  /** Force the islands bootstrap for zero-island pages that own another projection. */
  islandsBootstrapRequired?: boolean;
  /** Per-source-file CSS map produced by the vite plugin. */
  cssManifest?: Record<string, string[]>;
  /** Per-source-file JS map produced by the vite plugin for modulepreload hints. */
  jsManifest?: Record<string, string[]>;
  /** Maximum number of pages rendered concurrently. Defaults to 10. */
  concurrency?: number;
  /**
   * Static-export mode (`@pracht/adapter-static`): additionally prerender
   * loaderless `render: "spa"` routes (their shell document), and capture SSG
   * loader state so the build can serialize it for client-side navigation.
   */
  staticExport?: boolean;
}
declare function prerenderApp(options: PrerenderAppOptions): Promise<PrerenderResult[]>;
declare function prerenderApp(options: PrerenderAppOptions & {
  withISGManifest: true;
}): Promise<PrerenderAppResult>;
/**
 * Render errors are deliberately opaque in the response body, which leaves a
 * failing static build with a bare status and nothing to act on. Append the
 * real message so `pracht build` names the cause instead of only the symptom.
 */
declare function describeRenderError(error: unknown): string;
/**
 * The static-export SPA fallback document (conventionally `200.html`).
 *
 * A static host configured to rewrite unmatched URLs to this file (GitHub
 * Pages cannot; Netlify/nginx/S3+CloudFront can) lets deep links to
 * non-prerendered paths — dynamic `render: "spa"` routes above all — boot the
 * client router, which resolves the real route from `window.location` (see
 * the `fallback` hydration-state marker). The body is deliberately empty:
 * this document is served for *any* URL, so no route- or shell-specific
 * markup can be correct here.
 *
 * `head` is likewise explicit metadata shared by every rewritten URL. The
 * build cannot run a route-specific `head()` function for an arbitrary path.
 *
 * `notFoundData` and `notFoundError` are copied from the already-rendered
 * `404.html` hydration state. If the fallback resolves an unknown URL instead
 * of a dynamic SPA route, the not-found component or error boundary therefore
 * sees its normal build-time state without executing the loader a second time.
 */
declare function buildStaticFallbackHtml(options?: {
  clientEntryUrl?: string;
  head?: HeadMetadata;
  notFoundData?: unknown;
  notFoundError?: SerializedRouteError | null;
}): string;
//#endregion
export { ISGManifestEntry, PrerenderAppOptions, PrerenderAppResult, PrerenderResult, buildStaticFallbackHtml, describeRenderError, prerenderApp };