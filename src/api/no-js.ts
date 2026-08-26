import type { ApiRouteArgs } from "@pracht/core";
import {
  isSafeRedirect,
  NO_JS_COOKIE,
} from "../lib/no-js";

export async function POST({ request }: ApiRouteArgs) {
  const body = await request.formData();
  const enable = body.get("no-js") === "1";
  const redirectTo = isSafeRedirect(body.get("redirect"))
    ? String(body.get("redirect"))
    : "/";

  const headers = new Headers({ Location: redirectTo });
  if (enable) {
    headers.append(
      "Set-Cookie",
      `${NO_JS_COOKIE}=1; Path=/; SameSite=Lax`,
    );
  } else {
    headers.append(
      "Set-Cookie",
      `${NO_JS_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
    );
  }

  return new Response(null, { status: 303, headers });
}
