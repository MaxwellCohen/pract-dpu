//#region src/islands-client.d.ts
/**
 * Minimal islands bootstrap for routes rendered with `hydration: "islands"`.
 *
 * Scans the document for `<pracht-island>` markers emitted by the server,
 * dynamically imports only the island modules actually present on the page,
 * and hydrates each island in place with its serialized props. The full
 * client runtime (router, prefetching, route-state fetching) is never loaded.
 */
interface HydrateIslandsOptions {
  /**
   * Island module importers keyed by project-root-relative path, as produced
   * by `import.meta.glob("/src/islands/**")` in the generated bootstrap.
   */
  modules: Record<string, () => Promise<unknown>>;
}
declare function hydrateIslands(options: HydrateIslandsOptions): Promise<void>;
//#endregion
export { HydrateIslandsOptions, hydrateIslands };