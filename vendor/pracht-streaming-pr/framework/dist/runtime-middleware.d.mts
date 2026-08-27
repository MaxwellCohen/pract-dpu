//#region src/runtime-middleware.d.ts
type RedirectOptions = number | {
  baseUrl?: string | URL;
  method?: string;
  request?: Request;
  status?: number;
};
/**
 * Convenience helper for middleware (and loaders/handlers) to short-circuit
 * with a redirect Response. Validates the target's scheme and rejects
 * CR/LF injection. Root-absolute route paths are placed under the configured
 * deploy base; relative, protocol-relative, and absolute URLs are preserved.
 * Pass the current request (or method) when the default status should follow
 * HTTP method safety: safe methods default to 302, unsafe methods default to
 * 303.
 *
 * ```ts
 * export const middleware: MiddlewareFn = async ({ request }, next) => {
 *   if (!hasSession(request)) return redirect("/login", { request });
 *   return next();
 * };
 * ```
 *
 * In a **page loader or API route handler**, `return` and `throw` both work.
 * Throw when the decision is made somewhere the return value cannot escape
 * from — a shared `requireUser()` helper, a nested `await` — so the caller
 * cannot forget to propagate it:
 *
 * ```ts
 * export async function loader({ request, context }: LoaderArgs) {
 *   const user = await requireUser(request, context); // throws redirect("/login")
 *   return { user };
 * }
 * ```
 *
 * Capabilities are the exception: their dispatch answers with the typed
 * `{ ok, data }` envelope on every transport, so a `Response` thrown from a
 * capability `run()` has nowhere to go and surfaces as an `internal_error`.
 * Gate capabilities in their named middleware, which returns a `Response`
 * like any other middleware.
 */
declare function redirect(target: string, options?: RedirectOptions): Response;
//#endregion
export { RedirectOptions, redirect };