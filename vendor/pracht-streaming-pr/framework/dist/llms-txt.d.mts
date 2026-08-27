import { ModuleRegistry, ResolvedApiRoute, ResolvedPrachtApp } from "./types.mjs";

//#region src/llms-txt.d.ts
type LlmsTxtSection = "pages" | "api" | "capabilities";
interface BuildLlmsTxtOptions {
  app: ResolvedPrachtApp;
  apiRoutes?: readonly ResolvedApiRoute[];
  registry?: ModuleRegistry;
  /** H1 project title — the only required llms.txt element. */
  title: string;
  /** Blockquote summary rendered under the title. Omitted when empty. */
  description?: string;
  /**
   * Origin (e.g. "https://example.com") prepended to every link so the file
   * contains absolute URLs. Links stay root-relative when omitted.
   */
  origin?: string;
  /** Sections to emit. Defaults to "pages", "api", and "capabilities". */
  include?: readonly LlmsTxtSection[];
  /**
   * Route/API path patterns to leave out, using the same segment globs as
   * `defineApp({ constraints })` (`*` = one segment, trailing `**` = the rest).
   *
   * llms.txt is a list of URLs an agent is invited to fetch, so anything an
   * anonymous agent cannot actually use — pages behind an auth middleware,
   * internal tooling, deliberate error routes — belongs here. Patterns are
   * matched against the emitted paths, so a prerendered instance of a dynamic
   * route (`/blog/hello-world`) is covered by `/blog/**`, and a capability is
   * excluded by its dispatch path (`/api/capabilities/**`).
   *
   * Framework-reserved paths (any `_pracht` or `__pracht` segment, such as the
   * `@pracht/image` endpoint at `/api/_pracht/image`) are always omitted and
   * do not need an entry here.
   */
  exclude?: readonly string[];
  /**
   * Ceiling on how many prerendered instances a single dynamic route
   * contributes to the Pages section. Defaults to
   * {@link DEFAULT_MAX_PAGES_PER_ROUTE}; `0` lists every instance.
   * Must be a non-negative integer.
   *
   * The instances kept are the first ones `getStaticPaths()` returns, after
   * `exclude` is applied — the author's order, which for a blog is usually
   * newest-first. They are listed in path order like every other entry.
   *
   * llms.txt is an index, not a sitemap. A 5,000-post blog expanded through
   * `getStaticPaths()` produces a 5,000-line, 180 KB file — larger than most
   * agent context budgets, and the 4,990th post tells an agent nothing the
   * first ten did not. Truncation is never silent: a line above the Pages
   * section names the route and the ratio it lists.
   */
  maxPagesPerRoute?: number;
}
declare function buildLlmsTxt(options: BuildLlmsTxtOptions): Promise<string>;
//#endregion
export { BuildLlmsTxtOptions, LlmsTxtSection, buildLlmsTxt };