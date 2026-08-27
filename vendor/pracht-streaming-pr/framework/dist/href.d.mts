import { HrefFn, HrefRouteDefinition } from "./types.mjs";

//#region src/href.d.ts
declare function createHref(routes: readonly HrefRouteDefinition[]): HrefFn;
//#endregion
export { createHref };