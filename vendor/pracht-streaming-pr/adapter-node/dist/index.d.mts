import { ISGManifestEntry, MarkdownManifest, ModuleRegistry, PrachtApp, ResolvedApiRoute } from "@pracht/core/server";
import { IncomingMessage, ServerResponse } from "node:http";
import { PrachtAdapter } from "@pracht/vite-plugin";

//#region src/node-static.d.ts
type HeadersManifest = Record<string, Record<string, string>>;
declare function getCacheControl(urlPath: string): string;
interface StaticFileResult {
  filePath: string;
  contentType: string;
  cacheControl: string;
}
/**
 * Resolve a URL pathname to a static file inside `staticDir`.
 *
 * Tries the exact path first (e.g. `/assets/chunk-Ab12.js`), then falls back
 * to `{pathname}/index.html` for clean-URL pages (e.g. `/about` →
 * `about/index.html`).  Returns `null` when no matching file is found.
 */
declare function resolveStaticFile(staticDir: string, pathname: string, isgManifest?: Record<string, ISGManifestEntry>): Promise<StaticFileResult | null>;
//#endregion
//#region src/node-handler.d.ts
interface NodeAdapterContextArgs {
  request: Request;
  req: IncomingMessage;
  res: ServerResponse;
}
interface NodeAdapterOptions<TContext = unknown> {
  app: PrachtApp;
  registry?: ModuleRegistry;
  staticDir?: string;
  viteManifest?: unknown;
  isgManifest?: Record<string, ISGManifestEntry>;
  apiRoutes?: ResolvedApiRoute[];
  clientEntryUrl?: string;
  islandsEntryUrl?: string;
  islandsBootstrapRequired?: boolean;
  cssManifest?: Record<string, string[]>;
  jsManifest?: Record<string, string[]>;
  headersManifest?: HeadersManifest;
  /** Exact Markdown-capable routes. Omit to preserve negotiation for legacy/custom entries. */
  markdownManifest?: MarkdownManifest;
  createContext?: (args: NodeAdapterContextArgs) => TContext | Promise<TContext>;
  /**
   * Canonical public origin for request URL construction. When set, the Node
   * adapter ignores `Host` / forwarded host headers and always builds
   * `request.url` against this origin.
   */
  canonicalOrigin?: string;
  /**
   * Set when a trusted reverse proxy removes Vite's deploy base from the
   * request pathname before forwarding it. This prevents the framework from
   * mistaking a base-like first route segment for a retained deploy base.
   */
  basePathStripped?: boolean;
  /**
   * Whether to trust proxy headers (`Forwarded`, `X-Forwarded-Proto`,
   * `X-Forwarded-Host`) when constructing the request URL.
   *
   * When `canonicalOrigin` is set, it takes precedence and these headers are
   * ignored for URL construction.
   *
   * When **false** (the default) and no `canonicalOrigin` is set, the request
   * URL is derived from the socket: protocol is inferred from TLS state, and
   * host from the `Host` header. Forwarded headers are ignored.
   *
   * When **true**, forwarded headers are honored with the following precedence:
   *   1. RFC 7239 `Forwarded` header (`proto=` and `host=` directives)
   *   2. `X-Forwarded-Proto` / `X-Forwarded-Host`
   *   3. Socket-derived values (fallback)
   *
   * Enable this only when the Node server sits behind a trusted reverse proxy
   * (e.g. nginx, Cloudflare, a load balancer) that sets these headers.
   */
  trustProxy?: boolean;
  /** Maximum request body size in bytes. Defaults to 1 MiB. */
  maxBodySize?: number;
  /**
   * Compress responses with brotli or gzip based on `Accept-Encoding`
   * (default: `true`). Applies to HTML documents, route-state JSON, and other
   * compressible text types; static assets are compressed at runtime through
   * an in-memory LRU of compressed variants. Set to `false` when a reverse
   * proxy or CDN in front of the server already compresses responses.
   */
  compression?: boolean;
}
declare function createNodeRequestHandler<TContext = unknown>(options: NodeAdapterOptions<TContext>): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
//#endregion
//#region src/node-entry.d.ts
interface NodeServerEntryModuleOptions {
  canonicalOrigin?: string;
  /** Set when a trusted reverse proxy strips Vite's deploy base before forwarding. */
  basePathStripped?: boolean;
  port?: number;
  /** Vite-resolvable module path exporting `createContext(args)`. */
  createContextFrom?: string;
  /** Maximum request body size in bytes. Defaults to 1 MiB. */
  maxBodySize?: number;
  /**
   * Vite-resolvable module path exporting `configureServer(server)`. The
   * generated entry calls it (and awaits it) with the underlying `node:http`
   * server after `createServer()` and before `listen()`, when the entry is
   * run as the process entrypoint. This is the hook for everything pracht's
   * request handler cannot see — chiefly attaching a WebSocket server to the
   * `upgrade` event, which Node routes past the request handler entirely.
   * See docs/ADAPTERS.md § WebSockets for the full recipe including the
   * Origin check.
   */
  configureServerFrom?: string;
  /**
   * Compress responses with brotli or gzip based on `Accept-Encoding`
   * (default: `true`). Set to `false` when a reverse proxy or CDN in front of
   * the Node server already compresses responses.
   */
  compression?: boolean;
}
declare function createNodeServerEntryModule(options?: NodeServerEntryModuleOptions): string;
/**
 * Create a pracht adapter for Node.js.
 *
 * ```ts
 * import { nodeAdapter } from "@pracht/adapter-node";
 * pracht({ adapter: nodeAdapter() })
 * ```
 */
declare function nodeAdapter(options?: NodeServerEntryModuleOptions): PrachtAdapter;
//#endregion
export { type NodeAdapterContextArgs, type NodeAdapterOptions, type NodeServerEntryModuleOptions, type StaticFileResult, createNodeRequestHandler, createNodeServerEntryModule, getCacheControl, nodeAdapter, resolveStaticFile };