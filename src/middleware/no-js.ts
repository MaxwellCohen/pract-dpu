import { type MiddlewareFn } from "@pracht/core";
import {
  CSP_DISABLE_JS,
  isNoJsEnabled,
  readCounter,
} from "../lib/no-js";
import {
  clearRequestFlags,
  setRequestFlags,
} from "../lib/request-flags";

function withCsp(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP_DISABLE_JS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Keep request flags alive until a streaming body finishes (or errors). */
function withFlagsLifetime(response: Response): Response {
  if (!response.body) {
    clearRequestFlags();
    return response;
  }

  let cleared = false;
  const clearOnce = () => {
    if (cleared) return;
    cleared = true;
    clearRequestFlags();
  };

  const body = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        clearOnce();
      },
    }),
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const middleware: MiddlewareFn = async ({ request, url }, next) => {
  const noJs = isNoJsEnabled(request);
  const path = url.pathname || "/";
  const counter = readCounter(request);

  setRequestFlags({ noJs, path, counter });
  try {
    const response = await next();
    const withLifetime = withFlagsLifetime(response);
    if (!noJs) return withLifetime;
    return withCsp(withLifetime);
  } catch (error) {
    clearRequestFlags();
    throw error;
  }
};
