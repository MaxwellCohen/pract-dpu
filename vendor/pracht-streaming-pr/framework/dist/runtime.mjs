import { ROUTE_STATE_REQUEST_HEADER, SAFE_METHODS } from "./runtime-constants.mjs";
import { resolveBaseRedirectLocation, restoreBasePathInRequest, stripBase } from "./base.mjs";
import { matchApiRoute, matchAppRoute, resolveApp } from "./app.mjs";
import { collectFontHeadFragments } from "./font.mjs";
import { CLIENT_ENTRY_MANIFEST_KEY, ISLANDS_ENTRY_MANIFEST_KEY, mergeEntryPreloadUrls, resolveDataFunctions, resolveManifestEntries, resolvePageCssUrls, resolvePageJsUrls, resolveRegistryModule } from "./runtime-manifest.mjs";
import { IS_STATIC_TARGET, buildStaticRouteStateUrl } from "./runtime-static.mjs";
import { buildRouteStateUrl } from "./runtime-client-fetch.mjs";
import { appendVaryHeader, withDefaultSecurityHeaders, withEnhancedCapabilityFormRedirect, withRouteResponseHeaders } from "./runtime-headers.mjs";
import { mergeDocumentHeaders, mergeErrorHeadMetadata, mergeHeadMetadata, runMiddlewareChain } from "./runtime-middleware.mjs";
import { buildRuntimeDiagnostics, createSerializedRouteError, isPrachtHttpError, shouldExposeServerErrors } from "./runtime-errors.mjs";
import { DEFER_RUNTIME_SHIM, resolveDeferredData, serializeDeferred } from "./defer.mjs";
import { PrachtRuntimeProvider } from "./runtime-context.mjs";
import { ScriptCaptureContext, createScriptCapture, withCapturedScripts } from "./script.mjs";
import { buildHtmlDocument, buildHtmlDocumentParts, htmlResponse } from "./runtime-html.mjs";
import "./runtime-hooks.mjs";
import { IslandCaptureContext, getIslandsClientEntryUrl } from "./islands-server.mjs";
import { getRenderToStringAsync, isFrameworkFontHeadResponse, jsonErrorResponse, markFrameworkFontHeadResponse, normalizePageResponse, renderApiErrorResponse, renderRouteErrorResponse } from "./runtime-response.mjs";
import { streamingHtmlResponse } from "./runtime-stream.mjs";
import { getAppSpeculationRules } from "./runtime-speculation.mjs";
import { markdownResponse, prefersMarkdown } from "./runtime-negotiation.mjs";
import "./runtime-timing.mjs";
import { h } from "preact";
//#region src/runtime.ts
const SAME_ORIGIN_FETCH_SITE = "same-origin";
const BODY_REPRESENTATION_HEADERS = [
	"content-digest",
	"content-encoding",
	"content-length",
	"content-md5",
	"content-range",
	"digest",
	"etag",
	"last-modified",
	"repr-digest",
	"transfer-encoding"
];
function headersForReserializedBody(headers) {
	const nextHeaders = new Headers(headers);
	for (const name of BODY_REPRESENTATION_HEADERS) nextHeaders.delete(name);
	return nextHeaders;
}
function isJsonMediaType(contentType) {
	const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
	return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}
async function attachFontHeadToRouteStateResponse(options) {
	const { response, isRouteStateRequest, routeArgs } = options;
	if (!isRouteStateRequest) return response;
	if (!isJsonMediaType(response.headers.get("content-type") ?? "")) return response;
	let payload;
	try {
		payload = await response.clone().json();
	} catch {
		return response;
	}
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return response;
	const body = payload;
	if (isFrameworkFontHeadResponse(response) || typeof body.redirect === "string") return response;
	const [routeModuleResult, shellModuleResult] = await Promise.allSettled([options.routeModule, options.shellModule]);
	const routeModule = routeModuleResult.status === "fulfilled" ? routeModuleResult.value : void 0;
	const shellModule = shellModuleResult.status === "fulfilled" ? shellModuleResult.value : void 0;
	let fontHead = collectFontHeadFragments([]);
	try {
		const data = body.data;
		fontHead = collectFontHeadFragments((response.ok && !Object.hasOwn(body, "error") ? await mergeHeadMetadata(shellModule, routeModule, routeArgs, data) : await mergeErrorHeadMetadata(shellModule, routeModule, routeArgs)).fonts ?? []);
	} catch {}
	return Response.json({
		...body,
		fontHead
	}, {
		status: response.status,
		statusText: response.statusText,
		headers: headersForReserializedBody(response.headers)
	});
}
/**
* Stricter variant of first-party detection used to protect API requests
* that a cross-site page must not be able to make on the user's behalf:
* state-changing methods (CSRF) and WebSocket upgrades (cross-site
* WebSocket hijacking). It rejects any browser signal that points outside
* this exact origin — a cross-origin form POST will send `Origin` from the
* attacker, and `Sec-Fetch-Site: same-site` is not enough because sibling
* subdomains can be attacker-controlled. Requests with no browser
* provenance headers are treated as non-browser callers.
*/
function isSameOriginRequest(request, url) {
	const site = request.headers.get("sec-fetch-site");
	if (site && site !== SAME_ORIGIN_FETCH_SITE) return false;
	const origin = request.headers.get("origin");
	if (origin) try {
		return new URL(origin).origin === url.origin;
	} catch {
		return false;
	}
	if (site === SAME_ORIGIN_FETCH_SITE) return true;
	const referer = request.headers.get("referer");
	if (referer) try {
		return new URL(referer).origin === url.origin;
	} catch {
		return false;
	}
	return true;
}
/**
* Heuristic "this request came from our own page" check. Used to gate
* the `_data=1` query-param form of the route-state endpoint, which is
* otherwise reachable via any cross-origin `<a href>` / redirect.
*
* Accepts a request as first-party when:
*   - Sec-Fetch-Site is `same-origin` (modern browsers),
*   - OR Sec-Fetch-Site is absent AND the Origin header matches the
*     request URL's origin (older clients that still send Origin),
*   - OR Sec-Fetch-Site/Origin are absent AND Referer matches the request
*     URL's origin,
*   - OR no Origin/Sec-Fetch-Site/Referer is present (non-browser clients like
*     curl — CSRF is not the threat model there; blocking would break
*     tests and CLIs).
*/
function isFirstPartyFetch(request) {
	const site = request.headers.get("sec-fetch-site");
	if (site && site !== SAME_ORIGIN_FETCH_SITE) return false;
	const origin = request.headers.get("origin");
	if (origin) try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
	if (site === SAME_ORIGIN_FETCH_SITE) return true;
	const referer = request.headers.get("referer");
	if (referer) try {
		return new URL(referer).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
	return true;
}
async function handlePrachtRequest(options) {
	if (options.basePathStripped) options = {
		...options,
		basePathStripped: false,
		request: restoreBasePathInRequest(options.request)
	};
	const baseRedirect = createBaseRedirectResponse(options.request);
	if (baseRedirect) return baseRedirect;
	const url = new URL(options.request.url);
	const hasDataParam = url.searchParams.get("_data") === "1";
	if (hasDataParam) url.searchParams.delete("_data");
	const routePathname = stripBase(url.pathname);
	if (routePathname === null) return withDefaultSecurityHeaders(new Response("Not found", {
		status: 404,
		headers: { "content-type": "text/plain; charset=utf-8" }
	}));
	const requestPath = getRequestPath(url);
	const registry = options.registry ?? {};
	const resolvedApp = getResolvedApp(options.app);
	const hrefRoutes = resolvedApp.hrefRoutes ?? resolvedApp.routes;
	const headerSignalsRouteState = options.request.headers.get(ROUTE_STATE_REQUEST_HEADER) === "1";
	const dataParamIsFirstParty = hasDataParam && isFirstPartyFetch(options.request);
	const isRouteStateRequest = headerSignalsRouteState || dataParamIsFirstParty;
	const exposeDiagnostics = shouldExposeServerErrors(options);
	const requireSameOrigin = options.app.api.requireSameOrigin ?? true;
	const isUpgradeRequest = options.request.headers.has("upgrade");
	if (requireSameOrigin && isUpgradeRequest && !isSameOriginRequest(options.request, url)) return withDefaultSecurityHeaders(new Response("Cross-origin WebSocket upgrade blocked", {
		status: 403,
		headers: { "content-type": "text/plain; charset=utf-8" }
	}));
	let requestContext = options.context ?? {};
	const hasCapabilities = Object.keys(options.app.capabilities ?? {}).length > 0;
	const mcpConfig = options.app.agents?.mcp;
	let capabilityRuntime = null;
	let mcpRuntime = null;
	let agent = null;
	if (typeof __PRACHT_AGENT_SURFACE__ === "undefined" || __PRACHT_AGENT_SURFACE__) {
		if (hasCapabilities || mcpConfig) [capabilityRuntime, mcpRuntime] = await Promise.all([import("./runtime-capabilities.mjs"), mcpConfig ? import("./runtime-mcp.mjs") : Promise.resolve(null)]);
		const webBotAuth = options.app.agents?.webBotAuth;
		if (webBotAuth) {
			const { bindAgentContext } = await import("./runtime-agent-context.mjs");
			if (options.request.headers.has("signature-input")) {
				const { verifyAgentSignature } = await import("./runtime-agent-auth.mjs");
				agent = await verifyAgentSignature(options.request, webBotAuth);
			}
			try {
				requestContext = bindAgentContext(requestContext, agent);
			} catch (error) {
				warnAgentContextBindingFailure(error);
				return withDefaultSecurityHeaders(new Response(exposeDiagnostics ? `Request context could not carry verified agent identity: ${error instanceof Error ? error.message : String(error)}` : "Internal Server Error", {
					status: 500,
					headers: { "content-type": "text/plain; charset=utf-8" }
				}));
			}
			agent = requestContext.agent ?? null;
		}
		if (capabilityRuntime && (hasCapabilities || mcpConfig)) capabilityRuntime.setActiveCapabilityHost(options.request, options.app, registry, "http", options.onCapabilityAudit, agent);
	} else if (hasCapabilities || options.app.agents) warnAgentSurfaceElided();
	if (options.apiRoutes?.length) {
		const apiMatch = matchApiRoute(options.apiRoutes, routePathname);
		if (apiMatch) {
			const apiMiddlewareFiles = (options.app.api.middleware ?? []).flatMap((name) => {
				const middlewareFile = options.app.middleware[name];
				return middlewareFile ? [middlewareFile] : [];
			});
			let currentPhase = "middleware";
			if (requireSameOrigin && !SAFE_METHODS.has(options.request.method) && !isSameOriginRequest(options.request, url)) return withDefaultSecurityHeaders(new Response("Cross-origin request blocked", {
				status: 403,
				headers: { "content-type": "text/plain; charset=utf-8" }
			}));
			const requestSignal = AbortSignal.timeout(3e4);
			const apiContext = requestContext;
			const apiTerminal = async () => {
				currentPhase = "api";
				const apiModule = await resolveRegistryModule(registry.apiModules, apiMatch.route.file);
				if (!apiModule) throw new Error("API route module not found");
				const handler = apiModule[options.request.method.toUpperCase()] ?? apiModule.default;
				if (!handler) return new Response("Method not allowed", {
					status: 405,
					headers: { "content-type": "text/plain; charset=utf-8" }
				});
				return handler({
					request: options.request,
					params: apiMatch.params,
					pathname: apiMatch.pathname,
					context: apiContext,
					signal: requestSignal,
					url,
					route: apiMatch.route
				});
			};
			try {
				return withDefaultSecurityHeaders(withEnhancedCapabilityFormRedirect(await runMiddlewareChain({
					context: apiContext,
					middlewareFiles: apiMiddlewareFiles,
					params: apiMatch.params,
					pathname: apiMatch.pathname,
					registry,
					request: options.request,
					route: apiMatch.route,
					signal: requestSignal,
					url,
					terminal: apiTerminal
				}), options.request));
			} catch (error) {
				let thrownResponseFailure;
				if (error instanceof Response) try {
					return withDefaultSecurityHeaders(withEnhancedCapabilityFormRedirect(error, options.request));
				} catch (normalizeError) {
					thrownResponseFailure = normalizeError;
				}
				return renderApiErrorResponse({
					error: thrownResponseFailure ?? error,
					middlewareFiles: apiMiddlewareFiles,
					options,
					phase: currentPhase,
					route: apiMatch.route
				});
			}
		}
	}
	const isMcpRequest = !!mcpConfig && !!mcpRuntime && mcpRuntime.normalizeMcpRequestPath(routePathname) === mcpRuntime.resolveMcpEndpoint(options.app.agents);
	if (capabilityRuntime && (hasCapabilities || isMcpRequest)) {
		if (isMcpRequest) capabilityRuntime.setActiveCapabilityHost(options.request, options.app, registry, "mcp", options.onCapabilityAudit, agent);
		const { CAPABILITY_HTTP_PREFIX, envelopeResponse, handleCapabilityRequest, isRegisteredCapabilityHttpPath, matchCapabilityRoute, resolveAppCapabilities } = capabilityRuntime;
		let capabilities = hasCapabilities ? null : [];
		let capabilityResolutionError;
		try {
			if (hasCapabilities) capabilities = await resolveAppCapabilities(options.app, registry);
		} catch (error) {
			capabilityResolutionError = error;
			warnCapabilityResolutionFailure(error);
			if (!isMcpRequest && (routePathname.startsWith(CAPABILITY_HTTP_PREFIX) || await isRegisteredCapabilityHttpPath(options.app, registry, routePathname))) return withDefaultSecurityHeaders(envelopeResponse(500, {
				ok: false,
				error: {
					code: "internal_error",
					message: exposeDiagnostics ? `Capability registry failed to resolve: ${error instanceof Error ? error.message : String(error)}` : "Capability registry failed to resolve."
				}
			}));
		}
		if (isMcpRequest && mcpConfig && mcpRuntime) return withDefaultSecurityHeaders(await mcpRuntime.handleMcpRequest({
			app: options.app,
			capabilities: capabilities ?? [],
			context: requestContext,
			registry,
			request: options.request,
			url,
			exposeErrors: exposeDiagnostics,
			mcp: mcpConfig,
			apiMiddlewareFiles: (options.app.api.middleware ?? []).flatMap((name) => {
				const middlewareFile = options.app.middleware[name];
				return middlewareFile ? [middlewareFile] : [];
			}),
			agents: options.app.agents,
			agent,
			onAudit: options.onCapabilityAudit,
			resolutionError: capabilityResolutionError
		}));
		if (capabilities) {
			const capabilityMatch = matchCapabilityRoute(capabilities, routePathname);
			if (capabilityMatch) {
				if ((options.app.api?.requireSameOrigin ?? true) && !SAFE_METHODS.has(options.request.method) && !isSameOriginRequest(options.request, url)) return withDefaultSecurityHeaders(envelopeResponse(403, {
					ok: false,
					error: {
						code: "cross_origin_blocked",
						message: "Cross-origin request blocked"
					}
				}));
				return withDefaultSecurityHeaders(withEnhancedCapabilityFormRedirect(await handleCapabilityRequest({
					match: capabilityMatch,
					context: requestContext,
					registry,
					request: options.request,
					url,
					pathname: capabilityMatch.httpPath ?? routePathname,
					exposeErrors: exposeDiagnostics,
					apiMiddlewareFiles: (options.app.api.middleware ?? []).flatMap((name) => {
						const middlewareFile = options.app.middleware[name];
						return middlewareFile ? [middlewareFile] : [];
					}),
					agents: options.app.agents,
					agent,
					onAudit: options.onCapabilityAudit
				}), options.request));
			}
			if (routePathname.startsWith(CAPABILITY_HTTP_PREFIX)) return withDefaultSecurityHeaders(envelopeResponse(404, {
				ok: false,
				error: {
					code: "unknown_capability",
					message: "No capability is exposed at this path."
				}
			}));
		}
	}
	const match = matchAppRoute(resolvedApp, routePathname);
	if (!match) {
		if (isRouteStateRequest) return jsonErrorResponse(createSerializedRouteError("Not found", 404, {
			diagnostics: exposeDiagnostics ? buildRuntimeDiagnostics({
				phase: "match",
				status: 404
			}) : void 0,
			name: "Error"
		}), { isRouteStateRequest: true });
		const notFoundMatch = createNotFoundMatch(resolvedApp, routePathname);
		if (notFoundMatch && SAFE_METHODS.has(options.request.method)) return renderPageMatch(notFoundMatch, {
			isNotFoundPage: true,
			status: 404
		});
		return withDefaultSecurityHeaders(new Response("Not found", {
			status: 404,
			headers: { "content-type": "text/plain; charset=utf-8" }
		}));
	}
	if (!SAFE_METHODS.has(options.request.method)) {
		if (isRouteStateRequest) return jsonErrorResponse(createSerializedRouteError("Method not allowed", 405, {
			diagnostics: exposeDiagnostics ? buildRuntimeDiagnostics({
				middlewareFiles: match.route.middlewareFiles,
				phase: "action",
				route: match.route,
				shellFile: match.route.shellFile,
				status: 405
			}) : void 0,
			name: "Error"
		}), { isRouteStateRequest: true });
		return withRouteResponseHeaders(new Response("Method not allowed", {
			status: 405,
			headers: { "content-type": "text/plain; charset=utf-8" }
		}), { isRouteStateRequest });
	}
	return renderPageMatch(match, {
		isNotFoundPage: false,
		status: 200
	});
	/**
	* Render one page match through the middleware → loader → render pipeline.
	*
	* `status` is the success status of the rendered document (200 for a normal
	* route, 404 for the not-found page). `isNotFoundPage` marks a render that
	* is already the not-found page, so a 404 thrown from *its* loader cannot
	* re-enter this path.
	*/
	async function renderPageMatch(match, pageOptions) {
		const requestAbortController = new AbortController();
		const requestSignal = AbortSignal.any([
			AbortSignal.timeout(3e4),
			options.request.signal,
			requestAbortController.signal
		]);
		const pageContext = requestContext;
		const routeArgs = {
			request: options.request,
			params: match.params,
			context: pageContext,
			signal: requestSignal,
			url,
			route: match.route,
			pathname: match.pathname
		};
		let routeModulePromise;
		let routeModule;
		let shellModule;
		let shellModulePromise = Promise.resolve(void 0);
		let loaderFile;
		let currentPhase = "middleware";
		const timings = options.timings;
		try {
			routeModulePromise = resolveRegistryModule(registry.routeModules, match.route.file);
			shellModulePromise = match.route.shellFile ? resolveRegistryModule(registry.shellModules, match.route.shellFile) : Promise.resolve(void 0);
			const dataFunctionsPromise = routeModulePromise.then((mod) => resolveDataFunctions(match.route, mod, registry));
			routeModulePromise.catch(() => {});
			shellModulePromise.catch(() => {});
			dataFunctionsPromise.catch(() => {});
			const pageTerminal = async () => {
				currentPhase = "render";
				routeModule = await routeModulePromise;
				if (!routeModule) throw new Error(pageOptions.isNotFoundPage ? `notFound page module ${JSON.stringify(match.route.file)} was not found in the module registry. The not-found page is loaded from the same registry as route modules, so it has to live in the routes directory.` : "Route module not found");
				currentPhase = "loader";
				const { loader, loaderFile: resolvedLoaderFile } = await dataFunctionsPromise;
				loaderFile = resolvedLoaderFile;
				let loaderResult;
				const loaderStart = loader && timings ? performance.now() : 0;
				if (loader) try {
					loaderResult = await loader(routeArgs);
				} catch (error) {
					if (!(error instanceof Response)) throw error;
					loaderResult = error;
				}
				if (loaderResult instanceof Response) {
					if (timings) timings.loader = performance.now() - loaderStart;
					return loaderResult;
				}
				const willStream = match.route.streaming === true && (match.route.render ?? "ssr") === "ssr" && (match.route.hydration ?? "full") === "full" && !isRouteStateRequest;
				let data;
				try {
					data = willStream ? loaderResult : await resolveDeferredData(loaderResult);
				} finally {
					if (loader && timings) timings.loader = performance.now() - loaderStart;
				}
				if (isRouteStateRequest) {
					currentPhase = "render";
					shellModule = await shellModulePromise;
					const fontHead = collectFontHeadFragments((await mergeHeadMetadata(shellModule, routeModule, routeArgs, data)).fonts ?? []);
					const body = {
						data,
						fontHead
					};
					return markFrameworkFontHeadResponse(withRouteResponseHeaders(Response.json(body), {
						isRouteStateRequest: true,
						loaderCache: match.route.loaderCache
					}));
				}
				currentPhase = "render";
				shellModule = await shellModulePromise;
				const [head, documentHeaders] = await Promise.all([mergeHeadMetadata(shellModule, routeModule, routeArgs, data), mergeDocumentHeaders(shellModule, routeModule, routeArgs, data)]);
				const markdownRepresentation = typeof routeModule.markdown === "string" ? routeModule.markdown : void 0;
				if (markdownRepresentation !== void 0) appendVaryHeader(documentHeaders, "Accept");
				if (!isRouteStateRequest && markdownRepresentation !== void 0 && prefersMarkdown(options.request.headers.get("accept"))) return markdownResponse(markdownRepresentation, documentHeaders, pageOptions.status);
				const cssUrls = resolvePageCssUrls(options.cssManifest, match.route.shellFile, match.route.file);
				const modulePreloadUrls = mergeEntryPreloadUrls(options.jsManifest, CLIENT_ENTRY_MANIFEST_KEY, resolvePageJsUrls(options.jsManifest, match.route.shellFile, match.route.file));
				if (match.route.render === "spa") {
					const needsRouteState = loader != null || match.route.middlewareFiles.length > 0;
					let body = "";
					const Shell = shellModule?.Shell;
					const Loading = shellModule?.Loading;
					const loadingTree = Shell != null ? h(Shell, null, Loading ? h(Loading, null) : null) : Loading ? h(Loading, null) : null;
					const spaScriptCapture = createScriptCapture("full");
					if (loadingTree) {
						const tree = h(ScriptCaptureContext.Provider, { value: spaScriptCapture }, h(PrachtRuntimeProvider, {
							data: null,
							params: match.params,
							routeId: match.route.id ?? "",
							routes: hrefRoutes,
							url: requestPath
						}, loadingTree));
						body = await (await getRenderToStringAsync())(tree);
					}
					return htmlResponse(buildHtmlDocument({
						head: withCapturedScripts(head, spaScriptCapture),
						body,
						hydrationState: {
							url: requestPath,
							routeId: match.route.id ?? "",
							data: null,
							error: null,
							pending: needsRouteState
						},
						clientEntryUrl: options.clientEntryUrl,
						cssUrls,
						modulePreloadUrls,
						routeStatePreloadUrl: needsRouteState ? IS_STATIC_TARGET ? buildStaticRouteStateUrl(requestPath) : buildRouteStateUrl(requestPath) : void 0,
						speculationRules: getAppSpeculationRules(resolvedApp)
					}), pageOptions.status, documentHeaders);
				}
				const DefaultComponent = typeof routeModule.default === "function" ? routeModule.default : void 0;
				const Component = routeModule.Component ?? DefaultComponent;
				if (!Component) throw new Error("Route has no Component or default export");
				const Shell = shellModule?.Shell;
				const Comp = Component;
				const componentProps = {
					data,
					params: match.params
				};
				const componentTree = Shell ? h(Shell, null, h(Comp, componentProps)) : h(Comp, componentProps);
				let tree = h(PrachtRuntimeProvider, {
					data,
					params: match.params,
					routeId: match.route.id ?? "",
					routes: hrefRoutes,
					url: requestPath
				}, componentTree);
				const hydration = match.route.hydration ?? "full";
				const scriptCapture = createScriptCapture(hydration, willStream, head.script);
				tree = h(ScriptCaptureContext.Provider, { value: scriptCapture }, tree);
				let islandCapture = null;
				if (hydration === "islands") {
					islandCapture = { islands: [] };
					tree = h(IslandCaptureContext.Provider, { value: islandCapture }, tree);
				}
				if (willStream) {
					const { data: serializedData, pending } = serializeDeferred(data);
					const { prefix, afterShell, suffix } = buildHtmlDocumentParts({
						head: withCapturedScripts(head, scriptCapture),
						body: "",
						hydrationState: {
							url: requestPath,
							routeId: match.route.id ?? "",
							data: serializedData,
							deferred: pending.map(({ id, path }) => ({
								id,
								path
							})),
							error: null
						},
						clientEntryUrl: options.clientEntryUrl,
						clientEntryAtEnd: true,
						inlineBootstrapScript: pending.length > 0 ? {
							source: DEFER_RUNTIME_SHIM,
							nonce: head.fontNonce
						} : void 0,
						cssUrls,
						modulePreloadUrls: options.clientEntryUrl ? [...new Set([options.clientEntryUrl, ...modulePreloadUrls])] : modulePreloadUrls,
						speculationRules: getAppSpeculationRules(resolvedApp)
					});
					return await streamingHtmlResponse({
						tree,
						prefix,
						afterShell,
						suffix,
						status: pageOptions.status,
						headers: documentHeaders,
						signal: requestSignal,
						pending,
						nonce: head.fontNonce,
						exposeErrorDetails: exposeDiagnostics,
						onError: (error) => {
							console.error("[pracht] streaming render failed after the first flush:", error);
						},
						onCancel: () => {
							requestAbortController.abort(new DOMException("The streaming response consumer disconnected.", "AbortError"));
						}
					});
				}
				const ssrContent = await (await getRenderToStringAsync())(tree);
				if (hydration !== "full") {
					const islandFiles = [...new Set((islandCapture?.islands ?? []).map((usage) => usage.descriptor.file))];
					let islandsEntryUrl;
					if (hydration === "islands" && (islandFiles.length > 0 || options.islandsBootstrapRequired === true)) {
						islandsEntryUrl = options.islandsEntryUrl ?? getIslandsClientEntryUrl();
						if (!islandsEntryUrl) throw new Error(`Route "${match.route.path}" uses hydration: "islands" and requires the islands bootstrap${islandFiles.length > 0 ? ` for ${islandFiles.length} rendered island(s)` : " for a page-level runtime projection"}, but no bootstrap URL is registered. ` + (islandFiles.length > 0 ? "This usually means the @pracht/vite-plugin islands entry was not built — check that your islands live in the configured islands directory." : "This usually means generated page-runtime metadata was not forwarded by the deployment adapter."));
					}
					const preloadFiles = new Set((islandCapture?.islands ?? []).filter((usage) => usage.strategy === "load").map((usage) => usage.descriptor.file));
					const islandPreloadUrls = /* @__PURE__ */ new Set();
					if (options.jsManifest) for (const file of preloadFiles) for (const url of resolveManifestEntries(options.jsManifest, file) ?? []) islandPreloadUrls.add(url);
					return htmlResponse(buildHtmlDocument({
						head: withCapturedScripts(head, scriptCapture),
						body: ssrContent,
						clientEntryUrl: islandsEntryUrl,
						cssUrls,
						modulePreloadUrls: islandsEntryUrl ? mergeEntryPreloadUrls(options.jsManifest, ISLANDS_ENTRY_MANIFEST_KEY, [...islandPreloadUrls]) : [...islandPreloadUrls],
						speculationRules: getAppSpeculationRules(resolvedApp)
					}), pageOptions.status, documentHeaders);
				}
				return htmlResponse(buildHtmlDocument({
					head: withCapturedScripts(head, scriptCapture),
					body: ssrContent,
					hydrationState: {
						url: requestPath,
						routeId: match.route.id ?? "",
						data,
						error: null
					},
					clientEntryUrl: options.clientEntryUrl,
					cssUrls,
					modulePreloadUrls,
					speculationRules: getAppSpeculationRules(resolvedApp)
				}), pageOptions.status, documentHeaders);
			};
			let terminal = pageTerminal;
			let chainStart = 0;
			if (timings) {
				terminal = async () => {
					const terminalStart = performance.now();
					try {
						return await pageTerminal();
					} finally {
						timings.render = performance.now() - terminalStart - (timings.loader ?? 0);
					}
				};
				chainStart = performance.now();
			}
			const response = await runMiddlewareChain({
				context: pageContext,
				middlewareFiles: match.route.middlewareFiles,
				params: match.params,
				pathname: match.pathname,
				registry,
				request: options.request,
				route: match.route,
				signal: requestSignal,
				url,
				terminal
			});
			if (timings) timings.mw = performance.now() - chainStart - (timings.render ?? 0) - (timings.loader ?? 0);
			return await attachFontHeadToRouteStateResponse({
				response: normalizePageResponse(response, {
					isRouteStateRequest,
					loaderCache: match.route.loaderCache,
					markdown: match.route.markdown
				}),
				isRouteStateRequest,
				routeArgs,
				routeModule: routeModulePromise,
				shellModule: shellModulePromise
			});
		} catch (error) {
			let thrownResponseFailure;
			if (error instanceof Response) try {
				return await attachFontHeadToRouteStateResponse({
					response: normalizePageResponse(error, {
						isRouteStateRequest,
						loaderCache: match.route.loaderCache,
						markdown: match.route.markdown
					}),
					isRouteStateRequest,
					routeArgs,
					routeModule: routeModulePromise,
					shellModule: shellModulePromise
				});
			} catch (normalizeError) {
				thrownResponseFailure = normalizeError;
			}
			if (!pageOptions.isNotFoundPage && isNotFoundError(error) && !isRouteStateRequest) {
				const notFoundMatch = createNotFoundMatch(resolvedApp, match.pathname);
				if (notFoundMatch) {
					if (!(routeModule ?? await routeModulePromise?.catch(() => void 0))?.ErrorBoundary) return renderPageMatch(notFoundMatch, {
						isNotFoundPage: true,
						status: 404
					});
				}
			}
			routeModule ??= await routeModulePromise?.catch(() => void 0);
			shellModule ??= await shellModulePromise.catch(() => void 0);
			options.onRouteError?.(thrownResponseFailure ?? error, requestPath, {
				errorBoundary: routeModule?.ErrorBoundary ? "route" : shellModule?.ErrorBoundary ? "shell" : void 0,
				loaderFile: loaderFile ?? match.route.loaderFile,
				middlewareFiles: [...match.route.middlewareFiles ?? []],
				phase: currentPhase,
				routeFile: match.route.file,
				routeId: match.route.id,
				routePath: match.route.path,
				shellFile: match.route.shellFile
			});
			return renderRouteErrorResponse({
				error: thrownResponseFailure ?? error,
				isRouteStateRequest,
				loaderFile,
				options,
				phase: currentPhase,
				routeArgs,
				routeId: match.route.id ?? "",
				routeModule,
				routes: hrefRoutes,
				shellFile: match.route.shellFile,
				shellModule,
				requestPath
			});
		}
	}
}
/**
* Canonicalize a document request for a bare deploy base before an adapter's
* static-file fast path can serve it as the root route.
*
* @internal
*/
function createBaseRedirectResponse(request) {
	if (request.method !== "GET" && request.method !== "HEAD") return null;
	const url = new URL(request.url);
	const location = resolveBaseRedirectLocation(url.pathname, url.search);
	if (!location) return null;
	return withDefaultSecurityHeaders(new Response(null, {
		status: 308,
		headers: {
			"cache-control": "public, max-age=0, must-revalidate",
			location
		}
	}));
}
/**
* A `RouteMatch` for the app-level not-found page, or `undefined` when the
* app declares none. `pathname` is the matched, base-free request path passed
* to loaders, middleware, and route metadata callbacks. `useLocation()` keeps
* using the public request URL separately.
*/
function createNotFoundMatch(app, pathname) {
	const route = app.notFound;
	if (!route || !("segments" in route)) return void 0;
	return {
		route,
		params: {},
		pathname
	};
}
function isNotFoundError(error) {
	return isPrachtHttpError(error) && error.status === 404;
}
let warnedAgentSurfaceElided = false;
/** Build/runtime disagreement about the agent surface — log it once. */
function warnAgentSurfaceElided() {
	if (warnedAgentSurfaceElided) return;
	warnedAgentSurfaceElided = true;
	console.error("[pracht] This build dropped the capability and agent-trust runtime because the app manifest registered neither, but the running app has capabilities or an `agents` config. Capability requests will 404 and agent signatures will not be verified. Register capabilities as literal entries in `defineApp({ capabilities })` so the build can see them, then rebuild.");
}
let warnedCapabilityResolutionFailure = false;
/** Resolution failures repeat on every request — log the details once. */
function warnCapabilityResolutionFailure(error) {
	if (warnedCapabilityResolutionFailure) return;
	warnedCapabilityResolutionFailure = true;
	console.error("[pracht] Capability registry failed to resolve; capability requests will fail closed:", error);
}
/**
* Identity binding fails for the shape of the supplied context, so it fails on
* every request until the adapter supplies a bindable one — log the details
* once, since the 500 body stays generic in production.
*/
let warnedAgentContextBindingFailure = false;
function warnAgentContextBindingFailure(error) {
	if (warnedAgentContextBindingFailure) return;
	warnedAgentContextBindingFailure = true;
	console.error("[pracht] Verified agent identity could not be bound to the request context; requests fail closed with a 500:", error);
}
function getRequestPath(url) {
	return `${url.pathname}${url.search}`;
}
function getResolvedApp(app) {
	const routes = app.routes;
	const notFoundResolved = !app.notFound || "segments" in app.notFound;
	if ((routes.length === 0 || isHrefRouteDefinition(routes[0])) && notFoundResolved) return app;
	return resolveApp(app);
}
function isHrefRouteDefinition(value) {
	return Boolean(value && typeof value === "object" && "path" in value && "segments" in value && Array.isArray(value.segments));
}
//#endregion
export { createBaseRedirectResponse, handlePrachtRequest };
