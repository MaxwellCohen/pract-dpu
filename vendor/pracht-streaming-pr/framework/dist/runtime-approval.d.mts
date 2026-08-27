import { CapabilityApprovalPrincipalResolver, CapabilityApprovalStore, PrachtRequestContext } from "./types.mjs";
//#region src/runtime-approval.d.ts
/**
 * Register the store backing destructive-capability approvals. Call it from a
 * server-only module (a capability module, middleware, or a custom server
 * entry). Passing `null` unregisters.
 */
declare function setCapabilityApprovalStore(store: CapabilityApprovalStore | null): void;
/**
 * Register a server-only resolver for the application-authenticated identity
 * bound to approval proposals. Human approval without either this identity or
 * a verified agent identity fails closed.
 */
declare function setCapabilityApprovalPrincipalResolver<TContext = PrachtRequestContext>(resolver: CapabilityApprovalPrincipalResolver<TContext> | null): void;
interface MemoryApprovalStoreOptions {
  /** Clock override, unix seconds. Defaults to `Date.now()`. */
  now?: () => number;
}
/**
 * In-memory reference implementation.
 *
 * Correct for a single instance, and the semantics every other backend must
 * reproduce — but it is *not* durable: it is lost on restart and not shared
 * across replicas. Use it in tests, in development, and in single-instance
 * deployments; back a multi-replica deployment with a store that has
 * conditional writes.
 */
declare function createMemoryApprovalStore(options?: MemoryApprovalStoreOptions): CapabilityApprovalStore;
//#endregion
export { MemoryApprovalStoreOptions, createMemoryApprovalStore, setCapabilityApprovalPrincipalResolver, setCapabilityApprovalStore };