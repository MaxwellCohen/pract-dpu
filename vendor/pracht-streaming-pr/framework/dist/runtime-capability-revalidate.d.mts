//#region src/runtime-capability-revalidate.d.ts
/**
 * Effect-driven route revalidation after a capability call settles.
 *
 * A successful non-`read` capability call invalidates whatever the active
 * route's loader returned, so the runtime re-fetches it. The listener lives
 * here, apart from `runtime-context.ts`, because only two places can dispatch
 * `CAPABILITY_SETTLED_EVENT` — `<Form capability>` and the generated
 * `callCapability()` — and both call `ensureCapabilityRevalidation()` before
 * they do. An app that registers no capabilities therefore reaches neither
 * this module, `runtime-revalidate.ts`, nor `@pracht/capabilities` from its
 * client bundle.
 */
/**
 * Install the `CAPABILITY_SETTLED_EVENT` listener that refreshes route data.
 *
 * Idempotent, and safe to call before any provider has mounted: the listener
 * resolves the mounted runtimes when the event fires, not when it is added.
 *
 * @internal Called by the capability dispatch paths, not by app code.
 */
declare function ensureCapabilityRevalidation(): void;
//#endregion
export { ensureCapabilityRevalidation };