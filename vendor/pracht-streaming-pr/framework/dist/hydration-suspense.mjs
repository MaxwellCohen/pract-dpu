import { beginHydrationSuspension, isHydrationPending } from "./hydration.mjs";
import { options } from "preact";
//#region src/hydration-suspense.ts
/**
* Hydration suspension tracking — the part of `hydration.ts` that needs
* Preact's Suspense implementation.
*
* `useIsHydrationComplete()` / `onHydrationComplete()` must not fire while a
* Suspense boundary is still hydrating, which means counting the promises
* thrown during the initial hydration pass. That counting is only meaningful
* when the app actually renders a boundary, so it lives here instead of in
* `hydration.ts` — which every client bundle imports for `markHydrating()`.
*
* The installer is attached to the `Suspense` and `lazy` re-exports through a
* `/* @__PURE__ *\/` call in `suspense.ts`, so a bundle that never references
* either export drops this module and the compat Suspense implementation with it.
*/
const MODE_HYDRATE = 32;
let installed = false;
/**
* Install the hydration suspension counter and return `value` unchanged.
*
* Shaped as a pass-through so call sites can wrap the export that requires it
* (`Suspense`, `lazy`) in a `/* @__PURE__ *\/` annotation: the bundler drops
* both the call and this module when neither export survives tree-shaking.
*/
function withHydrationSuspenseTracking(value) {
	installHydrationSuspenseTracking();
	return value;
}
/**
* Install the counter directly.
*
* Preact's Suspense handler stops the chain at the first boundary it finds, so
* the compat handler must already exist before this tracker is installed, and
* any wrapper that also needs to observe suspensions must install after it.
* Route and shell modules load before the dev-only mismatch checker asks for
* this tracker, preserving that order without pulling compat into every app.
*/
function installHydrationSuspenseTracking() {
	if (installed) return;
	installed = true;
	const oldCatchError = options.__e;
	options.__e = (err, newVNode, oldVNode, errorInfo) => {
		if (isHydrationPending() && err && err.then) {
			if (!!(newVNode && newVNode.__u && newVNode.__u & MODE_HYDRATE) || !!(newVNode && newVNode.__h)) {
				const settle = beginHydrationSuspension();
				err.then(settle, settle);
			}
		}
		if (oldCatchError) oldCatchError(err, newVNode, oldVNode, errorInfo);
	};
}
//#endregion
export { installHydrationSuspenseTracking, withHydrationSuspenseTracking };
