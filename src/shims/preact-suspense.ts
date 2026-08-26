/**
 * Pracht ships `preact-suspense`, which does not participate in
 * `preact-render-to-string`'s chunked stream renderer.
 * `preact/compat` Suspense does (CHILD_DID_SUSPEND / `__c`), so we re-export
 * it under the `preact-suspense` name via a Vite alias.
 */
export { Suspense, lazy } from "preact/compat";
