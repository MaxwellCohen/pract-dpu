import { CapabilityEnvelope, CapabilityErrorPayload } from "@pracht/capabilities";

//#region src/capability-hook.d.ts
interface CapabilityCallState<TOutput> {
  /** Data from the most recent successful call, until `reset()`. */
  data: TOutput | undefined;
  /** Error payload from the most recent failed call, until `reset()`. */
  error: CapabilityErrorPayload | undefined;
  /** Whether a call is in flight. */
  pending: boolean;
}
interface CapabilityHookResult<TOutput, TArgs extends unknown[]> extends CapabilityCallState<TOutput> {
  /**
   * Dispatch the capability. Resolves to the same envelope `callCapability()`
   * returns — a failed call settles the envelope rather than throwing, so
   * branch on `result.ok` when you need the outcome at the call site.
   */
  call: (...args: TArgs) => Promise<CapabilityEnvelope<TOutput>>;
  /** Clear `data`/`error`/`pending` and abandon any in-flight result. */
  reset: () => void;
}
/**
 * Build a `useCapability` hook bound to a dispatch function. The generated
 * `virtual:pracht/capabilities` module calls this with its `callCapability`;
 * applications import the resulting hook, not this factory.
 */
declare function createUseCapability(dispatch: (name: string, ...args: unknown[]) => Promise<CapabilityEnvelope<unknown>>): <TOutput = unknown, TArgs extends unknown[] = unknown[]>(name: string) => CapabilityHookResult<TOutput, TArgs>;
//#endregion
export { CapabilityHookResult, createUseCapability };