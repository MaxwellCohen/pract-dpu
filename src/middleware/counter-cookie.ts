import {
  CAPABILITY_FORM_REQUEST_HEADER,
} from "@pracht/capabilities";
import type { MiddlewareFn } from "@pracht/core";
import { COUNTER_COOKIE, isSafeRedirect } from "../lib/no-js";

/**
 * Persist the capability's new count on the response. Native document form
 * posts would otherwise get a framework Referer redirect that drops Set-Cookie,
 * so those short-circuit here with a 303 + cookie.
 */
export const middleware: MiddlewareFn = async ({ request, url }, next) => {
  const response = await next();
  if (!response.ok) return response;

  let count: number | undefined;
  try {
    const envelope = (await response.clone().json()) as {
      ok?: boolean;
      data?: { count?: unknown };
    };
    if (
      envelope.ok &&
      typeof envelope.data?.count === "number" &&
      Number.isFinite(envelope.data.count)
    ) {
      count = envelope.data.count;
    }
  } catch {
    return response;
  }
  if (count == null) return response;

  const cookie = `${COUNTER_COOKIE}=${count}; Path=/; SameSite=Lax`;
  const contentType = request.headers.get("content-type") ?? "";
  const isFormPost =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
  const isEnhanced =
    request.headers.get(CAPABILITY_FORM_REQUEST_HEADER) === "1";
  const accept = request.headers.get("accept") ?? "";

  if (isFormPost && !isEnhanced && accept.includes("text/html")) {
    const referer = request.headers.get("referer");
    let back = "/";
    if (referer) {
      try {
        const parsed = new URL(referer);
        if (parsed.origin === url.origin) {
          const path = parsed.pathname + parsed.search;
          if (isSafeRedirect(path)) back = path;
        }
      } catch {
        // fall through to /
      }
    }
    const headers = new Headers({ Location: back });
    headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  }

  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
