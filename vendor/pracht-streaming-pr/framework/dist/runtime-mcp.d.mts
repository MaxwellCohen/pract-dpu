import { CapabilityAuditHook, McpAuthConfig, McpProjectionConfig, McpTokenPrincipal, ModuleRegistry, PrachtAgentIdentity as PrachtAgentIdentity$1, PrachtAgentsConfig } from "./types.mjs";
import { CapabilityHostApp, ResolvedCapability } from "./runtime-capabilities.mjs";
import { OAUTH_PROTECTED_RESOURCE_WELL_KNOWN } from "./runtime-constants.mjs";
import { isMcpResourceMetadataPath, isValidOAuthScopeToken, mcpResourceMetadataPath, mcpResourceMetadataUrl, resolveMcpEndpoint } from "./mcp-config.mjs";
import { MCP_CONFIRMATION_META_KEY as MCP_CONFIRMATION_META_KEY$1, MCP_LATEST_PROTOCOL_VERSION as MCP_LATEST_PROTOCOL_VERSION$1, MCP_PROTOCOL_VERSIONS as MCP_PROTOCOL_VERSIONS$1, MCP_PROTOCOL_VERSION_HEADER as MCP_PROTOCOL_VERSION_HEADER$1 } from "@pracht/capabilities";

//#region src/runtime-mcp.d.ts
/**
 * Capabilities the MCP projection serves, in graph order.
 *
 * `destructive` effects are filtered out unless the app opted in with
 * `agents.mcp.destructive`. The default is the conservative one: a capability
 * that declares `expose.mcp` and is destructive is simply invisible to the
 * transport, exactly as it was before the opt-in existed.
 */
declare function mcpExposedCapabilities(capabilities: readonly ResolvedCapability[], mcp?: McpProjectionConfig): ResolvedCapability[];
interface HandleMcpRequestOptions<TContext> {
  app: CapabilityHostApp;
  capabilities: readonly ResolvedCapability[];
  /** @internal Deferred so transport authentication runs before capability modules load. */
  loadCapabilities?: () => Promise<readonly ResolvedCapability[]>;
  context: TContext;
  registry: ModuleRegistry;
  request: Request;
  url: URL;
  exposeErrors: boolean;
  mcp: McpProjectionConfig;
  agents?: PrachtAgentsConfig;
  agent?: PrachtAgentIdentity$1 | null;
  /** @internal OAuth identity already verified for this transport request. */
  tokenPrincipal?: McpTokenPrincipal;
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
/**
 * Everything the prepare/commit flow needs before a destructive tool may be
 * advertised, checked in one place so all three answer the same way. Each of
 * these would otherwise produce the same broken shape: a tool listed in
 * `tools/list` that answers `confirmation_unavailable` on every call.
 */
declare function destructiveMcpPreconditionErrors(agents: PrachtAgentsConfig | undefined): string[];
/**
 * Serve the RFC 9728 protected-resource metadata document.
 *
 * Split out so `handlePrachtRequest()` can route the well-known path without
 * knowing anything about OAuth, and so the whole auth module stays behind a
 * dynamic import that apps with an unauthenticated `/mcp` never take.
 */
declare function handleMcpMetadataRequest(request: Request, auth: McpAuthConfig): Promise<Response>;
//#endregion
export { HandleMcpRequestOptions, MCP_CONFIRMATION_META_KEY$1 as MCP_CONFIRMATION_META_KEY, MCP_LATEST_PROTOCOL_VERSION$1 as MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS$1 as MCP_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSION_HEADER$1 as MCP_PROTOCOL_VERSION_HEADER, destructiveMcpPreconditionErrors, handleMcpMetadataRequest, handleMcpRequest, mcpExposedCapabilities };