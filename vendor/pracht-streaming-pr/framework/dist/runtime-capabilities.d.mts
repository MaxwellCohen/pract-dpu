import { CapabilityAuditHook, CapabilityCallInputFor, CapabilityEnvelope as CapabilityEnvelope$1, CapabilityName, CapabilityOutputFor, HasRegisteredCapabilities, ModuleRegistry, PrachtApp, PrachtCapability } from "./types.mjs";
import { capabilityHttpPath as capabilityHttpPath$1 } from "@pracht/capabilities";

//#region src/runtime-capabilities.d.ts
interface ResolvedCapability {
  name: string;
  file: string;
  capability: PrachtCapability;
  /** Dispatch path when `expose.http` is set, `null` for private capabilities. */
  httpPath: string | null;
  middlewareFiles: string[];
}
type CapabilityHostApp = Pick<PrachtApp, "agents" | "capabilities" | "middleware">;
declare function resolveAppCapabilities(app: CapabilityHostApp, registry: ModuleRegistry): Promise<ResolvedCapability[]>;
declare function matchCapabilityRoute(capabilities: readonly ResolvedCapability[], pathname: string): ResolvedCapability | undefined;
declare function setCapabilityAuditHook(hook: CapabilityAuditHook | null): void;
interface InvokeCapabilityContext<TContext = unknown> {
  /** The incoming request — middleware and `run()` receive it. */
  request: Request;
  context?: TContext;
  signal?: AbortSignal;
}
/**
 * Invoke a registered capability directly from server code (loaders, API
 * routes, middleware). Runs the exact same pipeline as the HTTP projection —
 * input validation, the capability's named middleware, `run()`, output
 * validation — and resolves to the same typed envelope. Works for private
 * (non-exposed) capabilities too.
 *
 * This is trusted first-party composition, so app-level `api.middleware` is
 * deliberately not re-applied and private capabilities remain callable as
 * building blocks. Remote MCP is the exception: a call composed under an MCP
 * tool re-applies the callee's `agentPolicy` and refuses destructive effects,
 * because otherwise a non-destructive tool could lend remote agents authority
 * that the callee's MCP projection would deny. Composed dispatches are audited
 * with `transport: "server"` and `via` set to the transport of the request being
 * served, so a remote-agent-caused effect stays attributable.
 *
 * When `pracht typegen` has registered the capability graph on
 * `Register["capabilities"]`, the name, input, and output types all come from
 * the registration: an unknown name or a mismatched input is a compile error,
 * not a runtime envelope.
 *
 * The untyped `invokeCapability<Output>(name, ...)` form remains for apps that
 * have not run typegen. Once anything is registered its `name` parameter
 * resolves to `never`, so a mistake can no longer fall through to it — which
 * is the whole point, but it does mean an explicit type argument is a compile
 * error in a registered app. Drop the type argument and let it infer.
 */
declare function invokeCapability<TName extends CapabilityName>(name: TName, input: CapabilityCallInputFor<TName>, ctx: InvokeCapabilityContext): Promise<CapabilityEnvelope$1<CapabilityOutputFor<TName>>>;
declare function invokeCapability<T = unknown>(name: HasRegisteredCapabilities extends true ? never : string, input: unknown, ctx: InvokeCapabilityContext): Promise<CapabilityEnvelope$1<T>>;
//#endregion
export { CapabilityHostApp, InvokeCapabilityContext, ResolvedCapability, capabilityHttpPath$1 as capabilityHttpPath, invokeCapability, matchCapabilityRoute, resolveAppCapabilities, setCapabilityAuditHook };