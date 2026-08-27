import { fetchPrachtRouteState, navigateToClientLocation } from "./runtime-client-fetch.mjs";
import { deserializeRouteError } from "./runtime-errors.mjs";
import { applyFontHeadFragments } from "./runtime-fonts.mjs";
//#region src/runtime-revalidate.ts
/**
* Re-fetch the active route's loader data and commit it to the runtime.
* Shared by `useRevalidate()`, `<Form capability>` submissions, and the
* capability-settled listener in the runtime provider, so every mutation
* path refreshes the page the same way.
*/
async function revalidateRouteData(runtime) {
	if (typeof window === "undefined") return;
	const result = await fetchPrachtRouteState(runtime?.url || window.location.pathname + window.location.search, { cache: "reload" });
	if (result.type === "redirect") {
		await navigateToClientLocation(result.location);
		return;
	}
	if (result.type === "error") throw deserializeRouteError(result.error);
	if (result.fontHead && runtimeOwnsCurrentLocation(runtime)) applyFontHeadFragments(result.fontHead);
	runtime?.setData(result.data);
	return result.data;
}
function runtimeOwnsCurrentLocation(runtime) {
	if (!runtime) return true;
	if (runtime.isCurrent) return runtime.isCurrent();
	try {
		const runtimeUrl = new URL(runtime.url, window.location.href);
		return runtimeUrl.pathname + runtimeUrl.search === window.location.pathname + window.location.search;
	} catch {
		return false;
	}
}
/** A settled capability call refreshes route data unless it was a read, failed, or opted out. */
function shouldRevalidateAfterCapability(detail) {
	if (!detail || typeof detail !== "object") return false;
	const settled = detail;
	return settled.ok === true && settled.effect !== "read" && settled.revalidate !== false;
}
//#endregion
export { revalidateRouteData, shouldRevalidateAfterCapability };
