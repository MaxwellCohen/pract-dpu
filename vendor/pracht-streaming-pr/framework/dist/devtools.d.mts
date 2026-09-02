import { ApiRouteExports, AppGraph, AppGraphApiRoute, AppGraphCapability, AppGraphModuleAccess, AppGraphRoute, AppGraphStaticModuleAccess, SerializeApiRoutesOptions, SerializeCapabilitiesOptions, buildAppGraph, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities } from "./app-graph.mjs";

//#region src/devtools.d.ts
declare const DEVTOOLS_PATH = "/_pracht";
declare const DEVTOOLS_JSON_PATH = "/_pracht.json";
/**
 * One recorded capability dispatch, as the dev devtools show it. A flattened
 * projection of `CapabilityAuditEvent` plus the wall-clock time the dev server
 * observed it — the audit event itself carries no timestamp, because a
 * production sink stamps events with its own clock.
 */
interface AgentTrafficEvent {
  /** Unix milliseconds, stamped when the dev server recorded the dispatch. */
  at: number;
  capability: string;
  effect: string;
  /** `"http" | "server" | "webmcp" | "mcp"` — how the dispatch arrived. */
  transport: string;
  /** Causal transport for nested `invokeCapability()` dispatches, else `null`. */
  via: string | null;
  /** `"ok"` or the envelope error code. */
  outcome: string;
  status: number;
  durationMs: number;
  /** Verified agent identity, `null` when unsigned or Web Bot Auth is off. */
  agent: {
    agentDomain: string | null;
    keyId: string;
  } | null;
}
/** The `agentTraffic` field of `/_pracht.json`. */
interface DevtoolsAgentTraffic {
  /** Ring-buffer capacity — older events past this count are dropped. */
  limit: number;
  /** Total dispatches observed since the dev server started; survives eviction. */
  recorded: number;
  /** Newest first, at most `limit` entries. */
  events: AgentTrafficEvent[];
}
declare function buildDevtoolsHtml(graph: AppGraph, options?: {
  base?: string;
  agentTraffic?: DevtoolsAgentTraffic;
}): string;
//#endregion
export { AgentTrafficEvent, type ApiRouteExports, type AppGraph, type AppGraphApiRoute, type AppGraphCapability, type AppGraphModuleAccess, type AppGraphRoute, type AppGraphStaticModuleAccess, DEVTOOLS_JSON_PATH, DEVTOOLS_PATH, DevtoolsAgentTraffic, type SerializeApiRoutesOptions, type SerializeCapabilitiesOptions, buildAppGraph, buildDevtoolsHtml, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities };