import { type MiddlewareFn } from "@pracht/core";
import { CSP_DISABLE_JS, isNoJsEnabled } from "../lib/no-js";
import { clearRequestFlags, setRequestFlags } from "../lib/request-flags";

function withCsp(response: Response): Response {
  // Reuse the same body stream so Pracht's streaming WeakSet still matches.
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP_DISABLE_JS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const middleware: MiddlewareFn = async ({ request, url }, next) => {
  const noJs = isNoJsEnabled(request);
  const path = url.pathname || "/";

  setRequestFlags({ noJs, path });
  try {
    const response = await next();
    // Do not clear flags or wrap `response.body` here. Streaming SSR keeps
    // resolving Suspense after `next()` returns, and Pracht identifies stream
    // responses via a WeakSet on the original body. The next request overwrites
    // the module-scoped flags.
    if (!noJs) return response;
    return withCsp(response);
  } catch (error) {
    clearRequestFlags();
    throw error;
  }
};
