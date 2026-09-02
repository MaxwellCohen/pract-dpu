import { McpAuthConfig, PrachtAgentsConfig } from "./types.mjs";
import { OAUTH_PROTECTED_RESOURCE_WELL_KNOWN } from "./runtime-constants.mjs";

//#region src/mcp-config.d.ts
/** RFC 6749 Appendix A.4 `scope-token` (printable ASCII except `"` and `\\`). */
declare function isValidOAuthScopeToken(value: unknown): value is string;
/** Resolved endpoint path, or `null` when the app does not serve MCP. */
declare function resolveMcpEndpoint(agents: PrachtAgentsConfig | undefined): string | null;
/**
 * The pathname RFC 9728 §3.1 assigns to a resource identifier: the well-known
 * segment is inserted *between* the host and the resource's own path, so
 * `https://app.example/mcp` publishes at
 * `/.well-known/oauth-protected-resource/mcp`.
 *
 * Note what that means under a deploy base. An app mounted at `/app/` whose
 * resource is `https://app.example/app/mcp` publishes at
 * `https://app.example/.well-known/oauth-protected-resource/app/mcp` — origin
 * root, base *inside* the suffix, not in front of it. The base is part of the
 * resource path, never a prefix of the well-known segment.
 */
declare function mcpResourceMetadataPath(auth: McpAuthConfig): string;
/** Absolute metadata URL — what the `WWW-Authenticate` challenge points at. */
declare function mcpResourceMetadataUrl(auth: McpAuthConfig): string;
/**
 * Whether a **URL** pathname addresses the metadata document.
 *
 * Takes the raw `url.pathname`, not a base-stripped route path: the document
 * lives at the origin root, so `stripBase()` answers `null` for it and the
 * request would 404 before ever reaching the MCP surface. `stripBaseLenient()`
 * is applied anyway so that a reverse proxy which re-prefixes the base (the
 * `basePathStripped` path) still resolves to the same document instead of
 * silently losing discovery.
 *
 * Both the RFC 9728 path-inserted form and the bare well-known root answer,
 * because hosts in the wild probe either. One trailing slash is tolerated, as
 * it is on the MCP endpoint itself.
 */
declare function isMcpResourceMetadataPath(pathname: string, auth: McpAuthConfig): boolean;
//#endregion
export { isMcpResourceMetadataPath, isValidOAuthScopeToken, mcpResourceMetadataPath, mcpResourceMetadataUrl, resolveMcpEndpoint };