import { withHydrationSuspenseTracking } from "./hydration-suspense.mjs";
import { Suspense, lazy } from "preact/compat";
//#region src/suspense.ts
/**
* Pracht's `Suspense` / `lazy` re-exports.
*
* They are wrapped rather than re-exported straight from `preact/compat` so
* the hydration suspension counter (`hydration-suspense.ts`) installs exactly
* when one of them is referenced. The `/* @__PURE__ *\/` annotations let the
* bundler drop the wrapper call — and with it the tracker and compat Suspense
* implementation — from apps that render no Suspense boundary.
*/
const Suspense$1 = /* @__PURE__ */ withHydrationSuspenseTracking(Suspense);
const lazy$1 = /* @__PURE__ */ withHydrationSuspenseTracking(lazy);
//#endregion
export { Suspense$1 as Suspense, lazy$1 as lazy };
