//#region src/islands-shared.ts
/**
* Shared constants for the islands (partial hydration) runtime. Kept in a
* dependency-free module so the tiny client bootstrap and the server renderer
* agree on the wire format without pulling each other in.
*/
/** Custom element the server wraps around every island's SSR output. */
const ISLAND_ELEMENT = "pracht-island";
/** Attribute carrying the island's project-root-relative source file. */
const ISLAND_FILE_ATTRIBUTE = "island";
/** Attribute carrying the export name of the island component. */
const ISLAND_EXPORT_ATTRIBUTE = "export";
/** Attribute carrying the hydration strategy (omitted for the default "load"). */
const ISLAND_STRATEGY_ATTRIBUTE = "client";
/** Attribute carrying the JSON-serialized props (omitted for empty props). */
const ISLAND_PROPS_ATTRIBUTE = "props";
/** Set on an island element once it has hydrated. */
const ISLAND_HYDRATED_ATTRIBUTE = "data-hydrated";
/**
* Set on `<html>` once the islands bootstrap has hydrated every `load`
* island on the page. Test tooling can wait for
* `html[data-pracht-islands-hydrated="true"]` before interacting.
*/
const ISLANDS_HYDRATED_MARKER = "data-pracht-islands-hydrated";
const ISLAND_STRATEGIES = [
	"load",
	"idle",
	"visible"
];
//#endregion
export { ISLANDS_HYDRATED_MARKER, ISLAND_ELEMENT, ISLAND_EXPORT_ATTRIBUTE, ISLAND_FILE_ATTRIBUTE, ISLAND_HYDRATED_ATTRIBUTE, ISLAND_PROPS_ATTRIBUTE, ISLAND_STRATEGIES, ISLAND_STRATEGY_ATTRIBUTE };
