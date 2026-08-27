import { CapabilityEnvelope as CapabilityEnvelope$1, CapabilityInputFor, CapabilityOutputFor, HasRegisteredCapabilities, MiddlewareFn, PrachtAgentIdentity as PrachtAgentIdentity$1, PrachtAgentsConfig, PrachtCapability, RegisteredCapabilityName } from "./types.mjs";
import { Capability } from "@pracht/capabilities";

//#region src/testing-capabilities.d.ts
interface CapabilityTestHostOptions<TCapabilities extends Record<string, PrachtCapability> = Record<string, PrachtCapability>> {
  /** Capability name → the object `defineCapability()` returns. */
  capabilities: TCapabilities;
  /** Middleware name → function, for capabilities declaring `middleware: [name]`. */
  middleware?: Record<string, MiddlewareFn>;
  /** App-level agent trust config — the `defineApp({ agents })` equivalent. */
  agents?: PrachtAgentsConfig;
}
interface CapabilityTestInvokeOptions {
  request?: Request;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
}
interface CapabilityTestRequestOptions {
  /** Extra request headers, e.g. `{ "x-pracht-confirm": token }`. */
  headers?: HeadersInit;
  context?: Record<string, unknown>;
  /**
   * Simulated verified Web Bot Auth identity. Drives `agentPolicy` checks,
   * the confirmation-token principal, audit events, and `context.agent` —
   * exactly as if the request carried a valid signature.
   */
  agent?: PrachtAgentIdentity$1 | null;
}
type RegisteredCapabilityTestMap = HasRegisteredCapabilities extends true ? { [TName in RegisteredCapabilityName]: {
  input: CapabilityInputFor<TName>;
  output: CapabilityOutputFor<TName>;
} } : Record<string, {
  input: unknown;
  output: unknown;
}>;
type CapabilityTestInput<TCapability> = TCapability extends Capability<infer TInput, any, any> ? TInput : TCapability extends {
  input: infer TInput;
} ? TInput : unknown;
type CapabilityTestInputFor<TCapabilities, TName extends Extract<keyof TCapabilities, string>> = (TName extends string ? (input: CapabilityTestInput<TCapabilities[TName]>) => void : never) extends ((input: infer TInput) => void) ? TInput : never;
type CapabilityTestOutput<TCapability> = TCapability extends Capability<any, infer TOutput, any> ? TOutput : TCapability extends {
  output: infer TOutput;
} ? TOutput : unknown;
interface CapabilityTestHost<TCapabilities extends Record<string, unknown> = RegisteredCapabilityTestMap> {
  /**
   * Direct server invocation — same pipeline and envelope as
   * `invokeCapability()`. Factory-created hosts read the input/output generics
   * retained by their own capability map, including test-only names that are
   * absent from the app manifest. Annotating a definition's `run()` argument
   * lets `defineCapability()` infer both generics; supplying only its first
   * generic leaves the defaulted output as `unknown`. The bare
   * `CapabilityTestHost` type keeps using the generated app registration for
   * callers that declare a host separately.
   */
  invoke<TName extends Extract<keyof TCapabilities, string>>(name: TName, input: CapabilityTestInputFor<TCapabilities, TName>, options?: CapabilityTestInvokeOptions): Promise<CapabilityEnvelope$1<CapabilityTestOutput<TCapabilities[TName]>>>;
  /** HTTP dispatch — same handler the generated `/api/capabilities/*` endpoints use. */
  request(name: string, input: unknown, options?: CapabilityTestRequestOptions): Promise<Response>;
}
declare function createCapabilityTestHost<const TCapabilities extends Record<string, PrachtCapability>>(options: CapabilityTestHostOptions<TCapabilities>): CapabilityTestHost<TCapabilities>;
//#endregion
export { CapabilityTestHost, CapabilityTestHostOptions, CapabilityTestInvokeOptions, CapabilityTestRequestOptions, createCapabilityTestHost };