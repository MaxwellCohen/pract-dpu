//#region src/runtime-constants.d.ts
/**
 * Set to `"1"` by the pracht CLI around the short-lived Vite server it boots
 * for graph-reading commands (`inspect`, `verify`, `doctor`, `plan`, `report`,
 * `typegen`). Those commands evaluate only the adapter-neutral
 * `virtual:pracht/dev-metadata` module, so the vite plugin omits
 * adapter-contributed Vite plugins — some of which own resources that
 * `server.close()` does not reclaim (`@cloudflare/vite-plugin` starts workerd
 * plus a debugger socket, which kept those commands alive indefinitely).
 *
 * Declared here so the CLI and the vite plugin cannot drift on the name.
 */
declare const PRACHT_GRAPH_ONLY_ENV = "PRACHT_GRAPH_ONLY";
/**
 * RFC 9728 well-known prefix for OAuth 2.0 protected-resource metadata.
 *
 * Lives here, not in the MCP modules, because `handlePrachtRequest()` needs to
 * recognise the path *before* it loads anything MCP-related — and before base
 * stripping, since RFC 9728 §3.1 inserts this segment between the host and the
 * resource's path, putting the document at the origin root by construction.
 */
declare const OAUTH_PROTECTED_RESOURCE_WELL_KNOWN = "/.well-known/oauth-protected-resource";
//#endregion
export { OAUTH_PROTECTED_RESOURCE_WELL_KNOWN, PRACHT_GRAPH_ONLY_ENV };