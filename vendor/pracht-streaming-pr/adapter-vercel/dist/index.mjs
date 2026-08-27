import { PRACHT_REVALIDATE_ENDPOINT, PRACHT_REVALIDATE_TOKEN_ENV, RevalidationReport, classifyRevalidationSkip, createBaseRedirectResponse, createISGRegenerationRequest, handlePrachtRequest, isCacheableISGResponse, isDangerousPrerenderHeader, jsonResponse, matchAppRoute, preventHeuristicCaching, readRevalidationRequest, resolveRevalidationToken, stripBase, withBase } from "@pracht/core/server";
//#region src/index.ts
function createVercelEdgeHandler(options) {
	return async (request, context) => {
		const baseRedirect = createBaseRedirectResponse(request);
		if (baseRedirect) return baseRedirect;
		if (stripBase(new URL(request.url).pathname) === PRACHT_REVALIDATE_ENDPOINT) return handleVercelRevalidationEndpoint(request, options.app);
		const prachtContext = options.createContext ? await options.createContext({
			request,
			context
		}) : context;
		const response = await handlePrachtRequest({
			app: options.app,
			registry: options.registry,
			request,
			context: prachtContext,
			apiRoutes: options.apiRoutes,
			clientEntryUrl: options.clientEntryUrl,
			islandsEntryUrl: options.islandsEntryUrl,
			islandsBootstrapRequired: options.islandsBootstrapRequired,
			cssManifest: options.cssManifest,
			jsManifest: options.jsManifest
		});
		if (isIsgRegenerationContext(context)) return response;
		return preventHeuristicCaching(request, response);
	};
}
/**
* Contexts minted by {@link createVercelNodeListener}, i.e. ISG prerender
* invocations. A `WeakSet` rather than a flag on the context object because the
* context is handed to application `createContext` factories, and this is
* adapter-internal bookkeeping they should not see or be able to forge.
*/
const isgRegenerationContexts = /* @__PURE__ */ new WeakSet();
function isIsgRegenerationContext(context) {
	return typeof context === "object" && context !== null && isgRegenerationContexts.has(context);
}
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
function createVercelNodeListener(handler) {
	return async (req, res) => {
		const waitUntilTasks = [];
		const context = { waitUntil(promise) {
			const task = Promise.resolve(promise);
			task.catch(() => {});
			waitUntilTasks.push(task);
		} };
		isgRegenerationContexts.add(context);
		try {
			const request = createNodeISGRequest(req);
			await writeNodeResponse(res, prepareVercelISGResponse(request, await handler(request, context)));
		} finally {
			await drainWaitUntilTasks(waitUntilTasks);
		}
	};
}
async function drainWaitUntilTasks(tasks) {
	let drained = 0;
	while (drained < tasks.length) {
		const batch = tasks.slice(drained);
		drained = tasks.length;
		await Promise.allSettled(batch);
	}
}
/**
* Derive the ISG regeneration request from the raw Node request. Only the
* forwarded origin and the path survive: everything else is request-specific
* state that must not influence output destined for a shared cache.
*/
function createNodeISGRequest(req) {
	const protocol = readNodeHeader(req, "x-forwarded-proto") ?? "https";
	const host = readNodeHeader(req, "x-forwarded-host") ?? readNodeHeader(req, "host") ?? "localhost";
	const url = new URL(req.url ?? "/", `${protocol}://${host}`);
	return createISGRegenerationRequest(url.pathname, url);
}
function readNodeHeader(req, name) {
	const value = req.headers[name] ?? req.headers[name.toUpperCase()];
	return Array.isArray(value) ? value[0] : value;
}
/**
* Vercel stores whatever a prerender function returns in the ISR cache and
* replays it to every later visitor. Build-time prerendering refuses to emit
* documents carrying credential headers at all; a runtime regeneration cannot
* fail the build, so strip them and keep serving the page.
*/
function prepareVercelISGResponse(request, response) {
	const pathname = new URL(request.url).pathname;
	const dangerous = [...response.headers.keys()].filter(isDangerousPrerenderHeader);
	let prepared = response;
	if (dangerous.length > 0) {
		const headers = new Headers(response.headers);
		for (const name of dangerous) headers.delete(name);
		console.error(`Stripped ${dangerous.map((name) => `"${name}"`).join(", ")} from the ISG response for "${pathname}" before Vercel's prerender cache stored it — cached ISG output is replayed to every visitor. Move cookies and credential headers to API routes, middleware responses, or an SSR route.`);
		prepared = new Response(response.body, {
			headers,
			status: response.status,
			statusText: response.statusText
		});
	}
	if (prepared.status === 200 && !isCacheableISGResponse(prepared)) console.warn(`The ISG response for "${pathname}" marks itself uncacheable (Cache-Control private/no-store or Vary on Cookie/Authorization), but Vercel's prerender cache stores it regardless. Render this route as SSR instead if its output is request-specific.`);
	return prepared;
}
async function writeNodeResponse(res, response) {
	res.statusCode = response.status;
	if (response.statusText) res.statusMessage = response.statusText;
	const setCookie = response.headers.getSetCookie?.call(response.headers) ?? [];
	response.headers.forEach((value, key) => {
		if (key.toLowerCase() === "set-cookie" && setCookie.length > 0) return;
		res.setHeader(key, value);
	});
	if (setCookie.length > 0) res.setHeader("set-cookie", setCookie);
	if (!response.body) {
		res.end();
		return;
	}
	const reader = response.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) res.write(value);
		}
	} finally {
		reader.releaseLock();
		res.end();
	}
}
function createVercelServerEntryModule(options = {}) {
	const functionName = options.functionName ?? "render";
	const regions = options.regions;
	return [
		options.createContextFrom ? `import { createContext as createPrachtContext } from ${JSON.stringify(options.createContextFrom)};` : "const createPrachtContext = undefined;",
		`export const vercelFunctionName = ${JSON.stringify(functionName)};`,
		`export const vercelRegions = ${JSON.stringify(regions ?? null)};`,
		"",
		"export default async function handle(request, context) {",
		"  const handler = createVercelEdgeHandler({",
		"    app: resolvedApp,",
		"    registry,",
		"    apiRoutes,",
		"    clientEntryUrl: clientEntryUrl ?? undefined,",
		"    islandsEntryUrl: islandsEntryUrl ?? undefined,",
		"    islandsBootstrapRequired,",
		"    cssManifest,",
		"    jsManifest,",
		"    createContext: createPrachtContext,",
		"  });",
		"  return handler(request, context);",
		"}",
		"",
		"// Entry point of the Node serverless functions emitted for ISG routes;",
		"// Vercel rejects `.prerender-config.json` next to an edge function.",
		"export const nodeListener = createVercelNodeListener(handle);",
		""
	].join("\n");
}
/**
* `x-vercel-cache` values that prove the prerender cache was actually
* refreshed. A `HIT`/`STALE` on a bypass request means Vercel ignored the
* `x-prerender-revalidate` header — the runtime token does not match the
* `bypassToken` baked into the build's `*.prerender-config.json`.
*/
const VERCEL_CACHE_REFRESH_STATUSES = new Set([
	"MISS",
	"REVALIDATED",
	"BYPASS"
]);
async function handleVercelRevalidationEndpoint(request, app) {
	const token = getRuntimeRevalidationToken();
	const parsed = await readRevalidationRequest(request, token);
	if (!parsed.ok) return parsed.response;
	const report = new RevalidationReport();
	for (const pathname of parsed.paths) {
		const match = matchAppRoute(app, pathname);
		const skip = classifyRevalidationSkip(match?.route, match !== null);
		if (skip) {
			report.skipped(pathname, skip);
			continue;
		}
		try {
			const revalidateUrl = new URL(withBase(pathname), request.url);
			const response = await fetch(revalidateUrl, {
				headers: {
					accept: "text/html",
					"x-prerender-revalidate": token
				},
				method: "GET"
			});
			if (!response.ok) {
				report.failed(pathname, `upstream_status_${response.status}`);
				continue;
			}
			const cacheStatus = response.headers.get("x-vercel-cache");
			if (cacheStatus === null || VERCEL_CACHE_REFRESH_STATUSES.has(cacheStatus.toUpperCase())) report.revalidated(pathname);
			else {
				console.error(`ISG webhook revalidation failed for ${pathname}: x-vercel-cache was "${cacheStatus}" — the revalidation token did not match the build-time bypass token; rebuild with ${PRACHT_REVALIDATE_TOKEN_ENV} set.`);
				report.failed(pathname, "prerender_cache_not_bypassed");
			}
		} catch (err) {
			console.error(`ISG webhook revalidation failed for ${pathname}:`, err);
			report.failed(pathname, "regeneration_error");
		}
	}
	return jsonResponse(report.toJSON());
}
function getRuntimeRevalidationToken() {
	return resolveRevalidationToken();
}
/**
* Create a pracht adapter for Vercel Edge Functions.
*
* ```ts
* import { vercelAdapter } from "@pracht/adapter-vercel";
* pracht({ adapter: vercelAdapter() })
* ```
*/
function vercelAdapter(options = {}) {
	return {
		id: "vercel",
		edge: true,
		serverImports: "import { resolveApp, resolveApiRoutes } from \"@pracht/core/server\";\nimport { createVercelEdgeHandler, createVercelNodeListener } from \"@pracht/adapter-vercel\";",
		createServerEntryModule() {
			return createVercelServerEntryModule(options);
		}
	};
}
//#endregion
export { createVercelEdgeHandler, createVercelNodeListener, createVercelServerEntryModule, vercelAdapter };
