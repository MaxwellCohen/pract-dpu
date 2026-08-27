import { CapabilityAuditHook, McpProjectionConfig, ModuleRegistry, PrachtAgentIdentity as PrachtAgentIdentity$1, PrachtAgentsConfig } from "./types.mjs";
import { CapabilityHostApp, ResolvedCapability } from "./runtime-capabilities.mjs";
import { resolveMcpEndpoint } from "./mcp-config.mjs";
import { MCP_CONFIRMATION_META_KEY as MCP_CONFIRMATION_META_KEY$1, MCP_LATEST_PROTOCOL_VERSION as MCP_LATEST_PROTOCOL_VERSION$1, MCP_PROTOCOL_VERSIONS as MCP_PROTOCOL_VERSIONS$1, MCP_PROTOCOL_VERSION_HEADER as MCP_PROTOCOL_VERSION_HEADER$1 } from "@pracht/capabilities";

//#region src/runtime-mcp.d.ts
/** Capabilities the MCP projection serves, in graph order. */
declare function mcpExposedCapabilities(capabilities: readonly ResolvedCapability[]): ResolvedCapability[];
interface HandleMcpRequestOptions<TContext> {
  app: CapabilityHostApp;
  capabilities: readonly ResolvedCapability[];
  context: TContext;
  registry: ModuleRegistry;
  request: Request;
  url: URL;
  exposeErrors: boolean;
  mcp: McpProjectionConfig;
  agents?: PrachtAgentsConfig;
  agent?: PrachtAgentIdentity$1 | null;
  apiMiddlewareFiles?: string[];
  onAudit?: CapabilityAuditHook;
  /** Registry resolution failure captured by the outer application runtime. */
  resolutionError?: unknown;
}
/**
 * Handle one request to the MCP endpoint. Always resolves — protocol problems
 * become JSON-RPC errors, capability problems become tool errors.
 */
declare function handleMcpRequest<TContext>(options: HandleMcpRequestOptions<TContext>): Promise<Response>;
//#endregion
export { HandleMcpRequestOptions, MCP_CONFIRMATION_META_KEY$1 as MCP_CONFIRMATION_META_KEY, MCP_LATEST_PROTOCOL_VERSION$1 as MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS$1 as MCP_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSION_HEADER$1 as MCP_PROTOCOL_VERSION_HEADER, handleMcpRequest, mcpExposedCapabilities };