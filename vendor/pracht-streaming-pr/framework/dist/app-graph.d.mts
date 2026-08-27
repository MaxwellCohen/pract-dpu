import { HttpMethod, ResolvedApiRoute, ResolvedPrachtApp, ResolvedRoute, SpeculationOption } from "./types.mjs";

//#region src/app-graph.d.ts
interface AppGraphRoute {
  file: string;
  hydration: string | null;
  id: string;
  loaderCache: number | false | null;
  loaderFile: string | null;
  /** Present only when middleware-owned Markdown negotiation is declared. */
  markdown?: true;
  middleware: string[];
  path: string;
  prefetch: string | null;
  render: string | null;
  revalidate: unknown;
  shell: string | null;
  shellFile: string | null;
  speculation: SpeculationOption | null;
  streaming: boolean | null;
}
interface AppGraphApiRoute {
  file: string;
  hasDefaultHandler: boolean;
  methods: string[];
  path: string;
}
interface AppGraphCapability {
  /**
   * Per-capability Web Bot Auth policy override, or `null` when the capability
   * inherits the app default. Part of the graph because a reviewer cannot
   * otherwise tell whether an exposed capability demands a verified agent.
   */
  agentPolicy: string | null;
  /** Prose contract description — feeds generated JSDoc and agent-facing inspection. */
  description: string | null;
  effect: string | null;
  /**
   * Why this capability's module could not be read, or `null` when it was read
   * successfully. A capability that fails to load (most often because
   * `@pracht/capabilities` is not installed) would otherwise serialize
   * identically to a private capability with no effect class, so every
   * inspection surface would quietly under-report what the app exposes.
   *
   * Optional so existing constructors of this shape stay valid; producers that
   * load modules (`serializeCapabilities`) always set it.
   */
  error?: string | null;
  /**
   * Set when the module could not be executed *and* static analysis could not
   * recover every guard-shaped field (`agentPolicy`, `middleware`). Those are
   * what `pracht plan` warns on, so silently reporting the fallback's blanks
   * would let deleting a capability's auth middleware produce no diff at all.
   */
  unverifiedContract?: true;
  /** Reserved for the MCP Apps projection — always false for now. */
  hasUi: false;
  httpPath: string | null;
  /** Input JSON Schema — feeds `pracht typegen` and agent-facing inspection. */
  input: Record<string, unknown> | null;
  middleware: string[];
  name: string;
  /** Output JSON Schema — feeds `pracht typegen` and agent-facing inspection. */
  output: Record<string, unknown> | null;
  source: string;
  title: string | null;
  /** Exposure transports from the capability's `expose` config. */
  transports: string[];
}
interface AppGraph {
  api: AppGraphApiRoute[];
  capabilities: AppGraphCapability[];
  /**
   * Path the remote MCP projection is served from, or `null` when the app does
   * not configure `agents.mcp` — in which case `expose.mcp` is recorded in the
   * graph but nothing serves it.
   */
  mcpEndpoint?: string | null;
  routes: AppGraphRoute[];
  /**
   * The app-level not-found page, serialized like a route. `null` when the app
   * declares none. It is reported separately from `routes` because it never
   * participates in matching.
   */
  notFound?: AppGraphRoute | null;
}
interface AppGraphModuleAccess {
  /** Import an app module by its app-relative file path (e.g. Vite's `ssrLoadModule`). */
  loadModule: (file: string) => Promise<Record<string, unknown>>;
  /** Read an app module's source text — fallback method detection when importing fails. */
  readSource: (file: string) => string;
}
interface SerializeCapabilitiesOptions {
  /** Fail the graph read when a registered capability module cannot load. */
  strict?: boolean;
}
interface SerializeApiRoutesOptions {
  /** Fail the graph read instead of inferring exports when an API module cannot load. */
  strict?: boolean;
}
interface AppGraphStaticModuleAccess {
  /** Read an app module by its app-relative file path. */
  readSource: (file: string) => string;
  /** Resolve a star re-export to another app-relative module. */
  resolveModule?: (specifier: string, importer: string) => string | null | Promise<string | null>;
}
declare function serializeAppRoutes(routes: readonly ResolvedRoute[]): AppGraphRoute[];
declare function serializeApiRoutes(apiRoutes: readonly ResolvedApiRoute[], access: AppGraphModuleAccess, options?: SerializeApiRoutesOptions): Promise<AppGraphApiRoute[]>;
/**
 * Serialize API method metadata without executing application modules.
 *
 * Used by the dev banner, where importing every API route at startup would run
 * unrelated top-level application work. Named re-exports expose their names
 * directly; star re-exports are followed through the caller's resolver.
 */
declare function serializeApiRoutesStatic(apiRoutes: readonly ResolvedApiRoute[], access: AppGraphStaticModuleAccess): Promise<AppGraphApiRoute[]>;
declare function serializeCapabilities(capabilities: Record<string, string> | undefined, access: AppGraphModuleAccess, options?: SerializeCapabilitiesOptions): Promise<AppGraphCapability[]>;
declare function buildAppGraph(options: {
  apiRoutes?: readonly ResolvedApiRoute[];
  app: ResolvedPrachtApp;
} & AppGraphModuleAccess): Promise<AppGraph>;
interface ApiRouteExports {
  /** `true` when the module exports a default catch-all request handler. */
  hasDefaultHandler: boolean;
  methods: HttpMethod[];
}
declare function detectApiExports(file: string, access: AppGraphModuleAccess): Promise<ApiRouteExports>;
/** Detect API exports from source text only, following relative star re-exports. */
declare function detectApiExportsStatic(file: string, access: AppGraphStaticModuleAccess, seen?: Set<string>): Promise<ApiRouteExports>;
declare function detectApiMethods(file: string, access: AppGraphModuleAccess): Promise<HttpMethod[]>;
//#endregion
export { ApiRouteExports, AppGraph, AppGraphApiRoute, AppGraphCapability, AppGraphModuleAccess, AppGraphRoute, AppGraphStaticModuleAccess, SerializeApiRoutesOptions, SerializeCapabilitiesOptions, buildAppGraph, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities };