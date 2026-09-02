import { withBase } from "./base.mjs";
import { SAFE_METHODS } from "./runtime-constants.mjs";
import { resolveRegistryModule } from "./runtime-manifest.mjs";
import { parseSafeNavigationUrl } from "./runtime-client-fetch.mjs";
import { applyHeaders } from "./runtime-headers.mjs";
//#region src/runtime-middleware.ts
const DEFAULT_REDIRECT_STATUS_SAFE = 302;
const DEFAULT_REDIRECT_STATUS_UNSAFE = 303;
const REDIRECT_VALIDATION_BASE = "https://invalid.pracht.local/";
/**
* Build a safe redirect response from middleware/loader output. Rejects
* non-http(s) schemes (no `javascript:`/`data:`/etc.) and CR/LF injection
* against the `Location` header. When status is omitted, non-GET/HEAD
* requests default to 303 so the browser does not resend the body to the
* redirect target; safe methods default to 302.
*
* The original `target` string is preserved on success (relative paths
* stay relative) — we only parse it to validate scheme, not to rewrite
* it. Both the original input and its resolved URL must be CR/LF-free.
*/
function buildRedirectResponse(target, options) {
	if (/[\r\n]/.test(target)) throw new Error("Refused redirect target containing CR/LF");
	if (!parseSafeNavigationUrl(target, options.baseUrl)) throw new Error("Refused unsafe redirect target");
	const method = (options.method ?? "GET").toUpperCase();
	const defaultStatus = SAFE_METHODS.has(method) ? DEFAULT_REDIRECT_STATUS_SAFE : DEFAULT_REDIRECT_STATUS_UNSAFE;
	const status = options.status ?? defaultStatus;
	return new Response(null, {
		status,
		headers: { location: target }
	});
}
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
function redirect(target, options = {}) {
	const location = withBase(target);
	if (typeof options === "number") return buildRedirectResponse(location, {
		baseUrl: REDIRECT_VALIDATION_BASE,
		status: options
	});
	return buildRedirectResponse(location, {
		baseUrl: options.baseUrl ?? options.request?.url ?? REDIRECT_VALIDATION_BASE,
		method: options.method ?? options.request?.method,
		status: options.status
	});
}
/**
* Run the middleware chain wrap-around-style. Each middleware receives
* `next` and may call it at most once. Calling `next()` invokes the rest
* of the chain (downstream middleware then `terminal`) and resolves to
* the final `Response`. A middleware that returns without calling `next()`
* short-circuits with whatever Response it returned.
*
* Module imports are kicked off concurrently up front; execution stays
* sequential because middleware may mutate `args.context` and ordering
* is part of the public contract.
*/
async function runMiddlewareChain(options) {
	const { middlewareFiles, terminal } = options;
	if (middlewareFiles.length === 0) return terminal();
	const modulePromises = middlewareFiles.map((mwFile) => resolveRegistryModule(options.registry.middlewareModules, mwFile));
	for (const p of modulePromises) p.catch(() => {});
	const dispatch = async (i) => {
		if (i >= middlewareFiles.length) return terminal();
		const mwModule = await modulePromises[i];
		if (typeof mwModule?.middleware !== "function") {
			const message = `Middleware "${middlewareFiles[i]}" does not export a \`middleware\` function. Middleware modules must \`export const middleware: MiddlewareFn = (args, next) => …\` (a default export is not used).`;
			warnMissingMiddlewareExport(middlewareFiles[i], message);
			throw new Error(message);
		}
		let calledNext = false;
		const next = () => {
			if (calledNext) throw new Error(`Middleware "${middlewareFiles[i]}" called next() multiple times`);
			calledNext = true;
			return dispatch(i + 1);
		};
		const args = {
			request: options.request,
			params: options.params,
			pathname: options.pathname,
			context: options.context,
			signal: options.signal,
			url: options.url,
			route: options.route
		};
		const response = await mwModule.middleware(args, next);
		if (!(response instanceof Response)) throw new Error(`Middleware "${middlewareFiles[i]}" did not return a Response. Middleware must return the result of next() or a short-circuit Response.`);
		return response;
	};
	return dispatch(0);
}
const warnedMissingMiddlewareExports = /* @__PURE__ */ new Set();
/** The failure repeats on every matching request — log the cause once. */
function warnMissingMiddlewareExport(file, message) {
	if (warnedMissingMiddlewareExports.has(file)) return;
	warnedMissingMiddlewareExports.add(file);
	console.error(`[pracht] ${message} Requests to routes using it fail closed.`);
}
async function mergeHeadMetadata(shellModule, routeModule, routeArgs, data) {
	const [shellHead, routeHead] = await Promise.all([shellModule?.head ? shellModule.head(routeArgs) : Promise.resolve({}), routeModule?.head ? routeModule.head({
		...routeArgs,
		data
	}) : Promise.resolve({})]);
	return mergeHeadValues(shellHead, routeHead);
}
/**
* Resolve head metadata while rendering an error boundary. Route heads receive
* no loader data on this path, so a data-dependent head may fail; keep the
* shell head in that case while still retaining static route registrations
* such as fonts.
*/
async function mergeErrorHeadMetadata(shellModule, routeModule, routeArgs) {
	let shellHead = {};
	if (shellModule?.head) try {
		shellHead = await shellModule.head(routeArgs);
	} catch {}
	let routeHead = {};
	if (routeModule?.head) try {
		routeHead = await routeModule.head({
			...routeArgs,
			data: void 0
		});
	} catch {}
	return mergeHeadValues(shellHead, routeHead);
}
function mergeHeadValues(shellHead, routeHead) {
	return {
		title: routeHead.title ?? shellHead.title,
		lang: routeHead.lang ?? shellHead.lang,
		meta: [...shellHead.meta ?? [], ...routeHead.meta ?? []],
		link: [...shellHead.link ?? [], ...routeHead.link ?? []],
		script: [...shellHead.script ?? [], ...routeHead.script ?? []],
		fontNonce: routeHead.fontNonce ?? shellHead.fontNonce,
		fonts: [...shellHead.fonts ?? [], ...routeHead.fonts ?? []]
	};
}
async function mergeDocumentHeaders(shellModule, routeModule, routeArgs, data) {
	const headers = new Headers();
	const [shellHeaders, routeHeaders] = await Promise.all([shellModule?.headers ? shellModule.headers(routeArgs) : Promise.resolve(void 0), routeModule?.headers ? routeModule.headers({
		...routeArgs,
		data
	}) : Promise.resolve(void 0)]);
	if (shellHeaders) applyHeaders(headers, shellHeaders);
	if (routeHeaders) applyHeaders(headers, routeHeaders);
	return headers;
}
//#endregion
export { mergeDocumentHeaders, mergeErrorHeadMetadata, mergeHeadMetadata, redirect, runMiddlewareChain };
