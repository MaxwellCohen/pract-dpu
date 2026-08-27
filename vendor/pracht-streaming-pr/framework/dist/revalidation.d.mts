import { RouteRevalidate, RouteRevalidatePolicy } from "./types.mjs";

//#region src/revalidation.d.ts
declare const PRACHT_REVALIDATE_ENDPOINT = "/__pracht/revalidate";
declare const PRACHT_REVALIDATE_TOKEN_ENV = "PRACHT_REVALIDATE_TOKEN";
declare const PRACHT_REVALIDATE_TOKEN_HEADER = "x-pracht-revalidate-token";
/**
 * The configured webhook revalidation token, read through `serverEnv` so it
 * resolves on every runtime pracht targets.
 *
 * Adapters must not reach for `process.env` (or `globalThis.process.env`)
 * themselves. Vite defines `process.env` away in edge SSR builds, and a
 * single-use local alias is inlined by the package bundler before Vite sees
 * it — which silently compiled the Vercel adapter's read down to
 * `return {}[PRACHT_REVALIDATE_TOKEN_ENV]` and made webhook revalidation
 * unauthenticatable in production. `serverEnv` centralises that hazard behind
 * one define-proof accessor that also picks up Cloudflare's request-scoped
 * bindings.
 */
declare function resolveRevalidationToken(): string | undefined;
/**
 * Why a revalidation webhook did not act on a path.
 *
 * The endpoint used to answer with bare path arrays, so a typo, a route that
 * is not ISG, and a route that simply never opted into `webhookRevalidate()`
 * were indistinguishable — an operator wiring a CMS got a `200` and silence.
 */
type RevalidationSkipReason = "not_a_route" | "not_isg" | "not_prerendered" | "no_webhook_policy";
type RevalidationOutcome = "revalidated" | "skipped" | "failed";
interface RevalidationDetail {
  path: string;
  outcome: RevalidationOutcome;
  /** Present for `skipped`, and for `failed` when the cause is known. */
  reason?: RevalidationSkipReason | string;
}
interface RevalidationReportBody {
  revalidated: string[];
  skipped: string[];
  failed: string[];
  details: RevalidationDetail[];
}
/**
 * Accumulates a revalidation batch's outcome.
 *
 * Shared by all three adapters so the wire shape cannot drift between them.
 * The three legacy arrays are still emitted verbatim — existing webhook
 * consumers keep working — with `details` carrying the per-path reason.
 */
declare class RevalidationReport {
  #private;
  revalidated(path: string): void;
  skipped(path: string, reason: RevalidationSkipReason): void;
  failed(path: string, reason?: string): void;
  toJSON(): RevalidationReportBody;
}
/**
 * Classify why a webhook cannot refresh a path, or `null` when it can.
 *
 * `entry` is what the adapter can act on — a prerender-manifest entry for Node
 * and Cloudflare, the matched app route for Vercel — and `prerendered` is
 * whether there is a cached copy to refresh (an on-disk HTML file for Node, a
 * manifest entry for Cloudflare; Vercel writes through the platform and passes
 * `true`).
 *
 * `matchedRoute` only refines the *reason*, never the decision. Without it, a
 * manifest-driven adapter reports every unknown path as `not_a_route` — so a
 * real SSR route that simply is not ISG was indistinguishable from a typo,
 * which is the confusion this whole field exists to remove. Pass `null` for
 * "looked and found nothing", or omit it when the caller has no route table.
 */
declare function classifyRevalidationSkip(entry: {
  render?: string;
  revalidate?: RouteRevalidate;
} | undefined, prerendered: boolean, matchedRoute?: {
  render?: string;
} | null): RevalidationSkipReason | null;
type RevalidationSingleFlight = <T>(key: string, task: () => Promise<T>) => Promise<T>;
/**
 * Deduplicate concurrent regenerations of the same path. Without this, a
 * stampede of requests against a stale ISG page (or repeated webhook posts)
 * triggers N parallel renders that all race to write the same output.
 * Callers sharing one single-flight instance receive the in-flight promise
 * instead of starting another regeneration.
 */
declare function createRevalidationSingleFlight(): RevalidationSingleFlight;
/**
 * An ISG response is safe to persist in a shared cache only when it doesn't
 * depend on request-specific state (cookies, auth) that the cached copy would
 * replay to every visitor. `Cache-Control: private` / `no-store`, any
 * `Set-Cookie`, and a `Vary` that implies per-request output (cookie,
 * authorization) all signal "don't cache this across users".
 */
declare function isCacheableISGResponse(response: Response): boolean;
/**
 * Headers that must never ride along with output stored in a shared cache.
 * Prerendered documents — and ISG responses regenerated at runtime — are
 * replayed verbatim to every visitor, so a `Set-Cookie` or credential header
 * produced by one render would be handed to all of them.
 */
declare function isDangerousPrerenderHeader(name: string): boolean;
type RevalidationRequestResult = {
  ok: true;
  paths: string[];
} | {
  ok: false;
  response: Response;
};
declare function normalizeRouteRevalidate(revalidate: RouteRevalidate): RouteRevalidatePolicy[];
declare function getTimeRevalidateSeconds(revalidate: RouteRevalidate | undefined): number | null;
declare function hasWebhookRevalidate(revalidate: RouteRevalidate | undefined): boolean;
declare function readRevalidationRequest(request: Request, token: string | undefined): Promise<RevalidationRequestResult>;
declare function isAuthorizedRevalidationRequest(request: Request, token: string | undefined): boolean;
/**
 * Build the request an ISG render runs on. The rendered HTML lands in a shared
 * cache and is replayed to every later visitor, so the render must not see the
 * triggering visitor's cookies, credentials, or query string — only the path.
 * `base` supplies the origin (a `Request`, `URL`, or absolute URL string).
 */
declare function createISGRegenerationRequest(pathname: string, base?: Request | URL | string): Request;
declare function jsonResponse(body: unknown, status?: number, headers?: HeadersInit): Response;
//#endregion
export { PRACHT_REVALIDATE_ENDPOINT, PRACHT_REVALIDATE_TOKEN_ENV, PRACHT_REVALIDATE_TOKEN_HEADER, RevalidationDetail, RevalidationOutcome, RevalidationReport, RevalidationReportBody, RevalidationSingleFlight, RevalidationSkipReason, classifyRevalidationSkip, createISGRegenerationRequest, createRevalidationSingleFlight, getTimeRevalidateSeconds, hasWebhookRevalidate, isAuthorizedRevalidationRequest, isCacheableISGResponse, isDangerousPrerenderHeader, jsonResponse, normalizeRouteRevalidate, readRevalidationRequest, resolveRevalidationToken };