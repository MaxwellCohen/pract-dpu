import { McpAuthConfig, McpTokenVerifier, ModuleRegistry } from "./types.mjs";
//#region src/runtime-mcp-auth.d.ts
/**
 * Resolve the `verify` module from the registry. The verifier is server-only
 * code, so it is registered as a module reference (like middleware and
 * capabilities) and looked up across every bucket the Vite plugin globs. A
 * suffix that identifies more than one module is rejected instead of letting
 * registry bucket order choose which security hook runs.
 *
 * Not memoized: the registry entry is an `import.meta.glob` thunk, so the ES
 * module cache already makes the second call free, and a framework-level cache
 * would silently pin the first registry a config object was ever seen with.
 */
declare function loadMcpTokenVerifier(auth: McpAuthConfig, registry: ModuleRegistry): Promise<McpTokenVerifier>;
//#endregion
export { loadMcpTokenVerifier };