import { DEFAULT_MCP_ENDPOINT } from "@pracht/capabilities";
//#region src/mcp-config.ts
/** Resolved endpoint path, or `null` when the app does not serve MCP. */
function resolveMcpEndpoint(agents) {
	const config = agents?.mcp;
	if (!config) return null;
	const path = config.path ?? DEFAULT_MCP_ENDPOINT;
	return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}
//#endregion
export { resolveMcpEndpoint };
