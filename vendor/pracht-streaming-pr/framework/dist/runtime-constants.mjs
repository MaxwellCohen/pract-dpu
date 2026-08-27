//#region src/runtime-constants.ts
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
const PRACHT_GRAPH_ONLY_ENV = "PRACHT_GRAPH_ONLY";
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const HYDRATION_STATE_ELEMENT_ID = "pracht-state";
const ROUTE_STATE_REQUEST_HEADER = "x-pracht-route-state-request";
const ROUTE_STATE_CACHE_CONTROL = "no-store";
const EMPTY_ROUTE_PARAMS = {};
const NOT_FOUND_ROUTE_ID = "__pracht_not_found__";
const NOT_FOUND_ROUTE_PATH = "(not found)";
const PREFETCH_ATTRIBUTE = "data-pracht-prefetch";
const PRESERVE_SCROLL_ATTRIBUTE = "data-pracht-preserve-scroll";
const VIEW_TRANSITION_ATTRIBUTE = "data-pracht-view-transition";
const SPECULATE_ATTRIBUTE = "data-pracht-speculate";
//#endregion
export { EMPTY_ROUTE_PARAMS, HYDRATION_STATE_ELEMENT_ID, NOT_FOUND_ROUTE_ID, NOT_FOUND_ROUTE_PATH, PRACHT_GRAPH_ONLY_ENV, PREFETCH_ATTRIBUTE, PRESERVE_SCROLL_ATTRIBUTE, ROUTE_STATE_CACHE_CONTROL, ROUTE_STATE_REQUEST_HEADER, SAFE_METHODS, SPECULATE_ATTRIBUTE, VIEW_TRANSITION_ATTRIBUTE };
