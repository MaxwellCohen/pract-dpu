import { buildHrefUntyped } from "./route-matching.mjs";
//#region src/href.ts
function createHref(routes) {
	return ((routeId, options) => buildHrefUntyped(routes, routeId, options));
}
//#endregion
export { createHref };
