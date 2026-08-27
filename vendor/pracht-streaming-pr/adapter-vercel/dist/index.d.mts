import { ModuleRegistry, PrachtApp, ResolvedApiRoute } from "@pracht/core/server";
import { PrachtAdapter } from "@pracht/vite-plugin";

//#region src/index.d.ts
interface VercelExecutionContext {
  waitUntil?(promise: Promise<unknown>): void;
  [key: string]: unknown;
}
interface VercelContextArgs<TVercelContext extends VercelExecutionContext = VercelExecutionContext> {
  request: Request;
  context: TVercelContext;
}
interface VercelAdapterOptions<TVercelContext extends VercelExecutionContext = VercelExecutionContext, TContext = TVercelContext> {
  app: PrachtApp;
  registry?: ModuleRegistry;
  apiRoutes?: ResolvedApiRoute[];
  clientEntryUrl?: string;
  islandsEntryUrl?: string;
  islandsBootstrapRequired?: boolean;
  cssManifest?: Record<string, string[]>;
  jsManifest?: Record<string, string[]>;
  createContext?: (args: VercelContextArgs<TVercelContext>) => TContext | Promise<TContext>;
}
interface VercelServerEntryModuleOptions {
  functionName?: string;
  regions?: string | string[];
  /** Vite-resolvable module path exporting `createContext(args)`. */
  createContextFrom?: string;
}
/**
 * Structural subset of Node's `IncomingMessage` used by the serverless
 * launcher. Typed inline so this edge-targeted package keeps no dependency on
 * `@types/node`.
 */
interface VercelNodeRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
}
/** Structural subset of Node's `ServerResponse` used by the serverless launcher. */
interface VercelNodeResponse {
  statusCode: number;
  statusMessage?: string;
  setHeader(name: string, value: string | string[]): unknown;
  write(chunk: Uint8Array): unknown;
  end(): unknown;
}
declare function createVercelEdgeHandler<TVercelContext extends VercelExecutionContext = VercelExecutionContext, TContext = TVercelContext>(options: VercelAdapterOptions<TVercelContext, TContext>): (request: Request, context: TVercelContext) => Promise<Response>;
/**
 * Wrap a `fetch`-style handler as the Node request listener the ISG prerender
 * functions run on.
 *
 * Vercel only supports ISR (`.prerender-config.json`) on Serverless Functions,
 * so ISG routes are deployed as Node functions even though the main handler
 * stays on the edge. Both share the same server bundle: it is built against Web
 * APIs only, which Node provides natively.
 *
 * Every invocation here renders into Vercel's prerender cache, which is keyed
 * on the path alone (`allowQuery: []`) and replayed to every later visitor. The
 * listener therefore renders on a sanitized ISG request rather than the
 * visitor's own — the triggering visitor's `Cookie`/`Authorization` headers,
 * query string, and body never reach loaders, so a cache miss cannot
 * materialize a personalized page into shared cache. This mirrors the Node and
 * Cloudflare adapters' regeneration path.
 *
 * Only web globals are used here — pulling in `node:http`/`node:stream` would
 * break the webworker-targeted bundle the edge function is built from.
 */
declare function createVercelNodeListener(handler: (request: Request, context: VercelExecutionContext) => Promise<Response>): (req: VercelNodeRequest, res: VercelNodeResponse) => Promise<void>;
declare function createVercelServerEntryModule(options?: VercelServerEntryModuleOptions): string;
/**
 * Create a pracht adapter for Vercel Edge Functions.
 *
 * ```ts
 * import { vercelAdapter } from "@pracht/adapter-vercel";
 * pracht({ adapter: vercelAdapter() })
 * ```
 */
declare function vercelAdapter(options?: VercelServerEntryModuleOptions): PrachtAdapter;
//#endregion
export { VercelAdapterOptions, VercelContextArgs, VercelExecutionContext, VercelNodeRequest, VercelNodeResponse, VercelServerEntryModuleOptions, createVercelEdgeHandler, createVercelNodeListener, createVercelServerEntryModule, vercelAdapter };