import { PrachtAgentsConfig } from "./types.mjs";

//#region src/mcp-config.d.ts
/** Resolved endpoint path, or `null` when the app does not serve MCP. */
declare function resolveMcpEndpoint(agents: PrachtAgentsConfig | undefined): string | null;
//#endregion
export { resolveMcpEndpoint };