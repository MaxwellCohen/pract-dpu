//#region src/runtime-headers.d.ts
declare function applyDefaultSecurityHeaders(headers: Headers): Headers;
/**
 * True for responses that switch protocols instead of carrying a body —
 * chiefly the `101 Switching Protocols` handshake a WebSocket upgrade
 * returns.
 *
 * Such a response must be handed back to the runtime as the *same object*
 * the handler produced. Copying it via `new Response(body, init)` fails
 * twice over: the Response constructor rejects any status below 200, and
 * the `webSocket` property (Cloudflare Workers' handle on the server end of
 * the socket) is not part of `ResponseInit`, so it is silently dropped even
 * where the status is tolerated. Header post-processing is skipped for the
 * same reason — and costs nothing, because a handshake has no body for a
 * sniffing or framing policy to protect.
 *
 * Detection reads `webSocket` explicitly rather than using `in`, because
 * workerd defines a `webSocket` getter on `Response.prototype` — `in` is
 * true there for every response.
 */
declare function isProtocolSwitchResponse(response: Response): boolean;
/**
 * Stamp `Cache-Control: private, no-cache` on GET/HEAD responses that carry no
 * caching policy of their own.
 *
 * A shared cache in front of the app — Cloudflare's Workers Caching, a CDN, a
 * reverse proxy — may apply RFC 9111 heuristic freshness to a `200` that has no
 * `Cache-Control`, and `Cookie` is not part of its cache key. Without this, an
 * authenticated SSR page or an API `GET` can be stored and replayed to another
 * user. The hazard is a property of "shared cache in front of an origin", not
 * of any one platform, so every adapter applies the same default: leaving it to
 * Cloudflare alone meant an app hardened there silently lost the protection
 * when it moved to Node or Vercel.
 *
 * Anything that set its own policy passes through untouched: ISG responses,
 * route-state JSON, static assets, and user `headers()` exports or middleware.
 */
declare function preventHeuristicCaching(request: Request, response: Response): Response;
//#endregion
export { applyDefaultSecurityHeaders, isProtocolSwitchResponse, preventHeuristicCaching };