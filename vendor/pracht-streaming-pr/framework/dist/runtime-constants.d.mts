//#region src/runtime-constants.d.ts
/**
 * Set to `"1"` by the pracht CLI around the short-lived Vite server it boots
 * for graph-reading commands (`inspect`, `verify`, `doctor`, `plan`, `report`,
 * `typegen`). Those commands evaluate only the adapter-neutral
 * `virtual:pracht/dev-metadata` module, so the vite plugin omits
 * adapter-contributed Vite plugins — some of which own resources that
 * `server.close()` does not reclaim (`@cloudflare/vite-plugin` starts workerd
 * plus a debugger socket, which kept those commands alive indefinitely).
 *
 * Declared here so the CLI and the vite plugin cannot drift on the name.
 */
declare const PRACHT_GRAPH_ONLY_ENV = "PRACHT_GRAPH_ONLY";
//#endregion
export { PRACHT_GRAPH_ONLY_ENV };