import { collectFontHeadFragments } from "./font.mjs";
import { CLIENT_ENTRY_MANIFEST_KEY, ISLANDS_ENTRY_MANIFEST_KEY, mergeEntryPreloadUrls, resolveManifestEntries, resolvePageCssUrls, resolvePageJsUrls, resolveRegistryModule } from "./runtime-manifest.mjs";
import { appendVaryHeader, applySecurityAndRouteHeaders, withDefaultSecurityHeaders, withRouteResponseHeaders } from "./runtime-headers.mjs";
import { mergeDocumentHeaders, mergeErrorHeadMetadata } from "./runtime-middleware.mjs";
import { buildRuntimeDiagnostics, deserializeRouteError, normalizeRouteError, shouldExposeServerErrors } from "./runtime-errors.mjs";
import { PrachtRuntimeProvider } from "./runtime-context.mjs";
import { buildHtmlDocument, htmlResponse } from "./runtime-html.mjs";
import { IslandCaptureContext, getIslandsClientEntryUrl } from "./islands-server.mjs";
import { h, options } from "preact";
//#region src/runtime-response.ts
let _renderToStringAsync;
let _renderToReadableStream;
const frameworkFontHeadResponses = /* @__PURE__ */ new WeakSet();
function markFrameworkFontHeadResponse(response) {
	frameworkFontHeadResponses.add(response);
	return response;
}
function isFrameworkFontHeadResponse(response) {
	return frameworkFontHeadResponses.has(response);
}
async function getRenderToStringAsync() {
	options.errorBoundaries = true;
	if (_renderToStringAsync) return _renderToStringAsync;
	_renderToStringAsync = (await import("preact-render-to-string")).renderToStringAsync;
	return _renderToStringAsync;
}
/**
* The streaming renderer, loaded lazily so routes that never stream do not pay
* for the `preact-render-to-string/stream` entry.
*
* Sets the same process-wide `errorBoundaries` flag as the buffered renderer:
* both paths render the same trees and a class `ErrorBoundary` has to behave
* identically whichever one runs.
*/
async function getRenderToReadableStream() {
	options.errorBoundaries = true;
	if (_renderToReadableStream) return _renderToReadableStream;
	_renderToReadableStream = (await import("preact-render-to-string/stream")).renderToReadableStream;
	return _renderToReadableStream;
}
function jsonErrorResponse(routeError, options) {
	const headers = applySecurityAndRouteHeaders(new Headers({ "content-type": "application/json; charset=utf-8" }), options.isRouteStateRequest ? { isRouteStateRequest: true } : void 0);
	return new Response(JSON.stringify({
		error: routeError,
		...options.fontHead ? { fontHead: options.fontHead } : {}
	}), {
		status: routeError.status,
		headers
	});
}
function jsonRedirectResponse(location, options) {
	const headers = new Headers(options.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	return withRouteResponseHeaders(new Response(JSON.stringify({ redirect: location }), {
		status: 200,
		headers
	}), { isRouteStateRequest: options.isRouteStateRequest });
}
function normalizePageResponse(response, options) {
	const hasFrameworkFontHead = isFrameworkFontHeadResponse(response);
	if (options.isRouteStateRequest && response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location");
		if (location) return jsonRedirectResponse(location, {
			headers: response.headers,
			isRouteStateRequest: true
		});
	}
	const normalized = withRouteResponseHeaders(response, {
		isRouteStateRequest: options.isRouteStateRequest,
		loaderCache: response.ok ? options.loaderCache : void 0
	});
	if (options.markdown === true && !options.isRouteStateRequest) appendVaryHeader(normalized.headers, "Accept");
	return hasFrameworkFontHead ? markFrameworkFontHeadResponse(normalized) : normalized;
}
function renderApiErrorResponse(options) {
	const exposeDetails = shouldExposeServerErrors(options.options);
	const routeError = normalizeRouteError(options.error, { exposeDetails });
	const routeErrorWithDiagnostics = exposeDetails ? {
		...routeError,
		diagnostics: buildRuntimeDiagnostics({
			middlewareFiles: options.middlewareFiles,
			phase: options.phase,
			route: options.route,
			status: routeError.status
		})
	} : routeError;
	if (exposeDetails) return jsonErrorResponse(routeErrorWithDiagnostics, { isRouteStateRequest: false });
	const message = routeErrorWithDiagnostics.status >= 500 ? "Internal Server Error" : routeErrorWithDiagnostics.message;
	return withDefaultSecurityHeaders(new Response(message, {
		status: routeErrorWithDiagnostics.status,
		headers: { "content-type": "text/plain; charset=utf-8" }
	}));
}
async function renderRouteErrorResponse(options) {
	const exposeDetails = shouldExposeServerErrors(options.options);
	const routeError = normalizeRouteError(options.error, { exposeDetails });
	const routeErrorWithDiagnostics = exposeDetails ? {
		...routeError,
		diagnostics: buildRuntimeDiagnostics({
			loaderFile: options.loaderFile,
			middlewareFiles: options.routeArgs.route.middlewareFiles,
			phase: options.phase,
			route: options.routeArgs.route,
			shellFile: options.shellFile,
			status: routeError.status
		})
	} : routeError;
	const shellModule = options.shellModule ?? (options.shellFile ? await resolveRegistryModule(options.options.registry?.shellModules, options.shellFile).catch(() => void 0) : void 0);
	if (options.isRouteStateRequest) {
		let fontHead = collectFontHeadFragments([]);
		try {
			fontHead = collectFontHeadFragments((await mergeErrorHeadMetadata(shellModule, options.routeModule, options.routeArgs)).fonts ?? []);
		} catch {}
		return jsonErrorResponse(routeErrorWithDiagnostics, {
			fontHead,
			isRouteStateRequest: true
		});
	}
	const ErrorBoundary = options.routeModule?.ErrorBoundary ?? shellModule?.ErrorBoundary;
	if (!ErrorBoundary) {
		const message = routeErrorWithDiagnostics.status >= 500 && !exposeDetails ? "Internal Server Error" : routeErrorWithDiagnostics.message;
		const diagnostics = exposeDetails && routeErrorWithDiagnostics.diagnostics ? `\n\n${JSON.stringify(routeErrorWithDiagnostics.diagnostics, null, 2)}` : "";
		return withDefaultSecurityHeaders(new Response(`${message}${diagnostics}`, {
			status: routeErrorWithDiagnostics.status,
			headers: { "content-type": "text/plain; charset=utf-8" }
		}));
	}
	const head = await mergeErrorHeadMetadata(shellModule, options.routeModule, options.routeArgs);
	const documentHeaders = await mergeDocumentHeaders(shellModule, void 0, options.routeArgs, void 0);
	const cssUrls = resolvePageCssUrls(options.options.cssManifest, options.shellFile, options.routeArgs.route.file);
	const modulePreloadUrls = mergeEntryPreloadUrls(options.options.jsManifest, CLIENT_ENTRY_MANIFEST_KEY, resolvePageJsUrls(options.options.jsManifest, options.shellFile, options.routeArgs.route.file));
	const renderToString = await getRenderToStringAsync();
	const Boundary = ErrorBoundary;
	const Shell = shellModule?.Shell;
	const errorValue = deserializeRouteError(routeErrorWithDiagnostics);
	const componentTree = Shell ? h(Shell, null, h(Boundary, { error: errorValue })) : h(Boundary, { error: errorValue });
	let tree = h(PrachtRuntimeProvider, {
		data: null,
		routeId: options.routeId,
		routes: options.routes,
		url: options.requestPath
	}, componentTree);
	const hydration = options.routeArgs.route.hydration ?? "full";
	let islandCapture = null;
	if (hydration === "islands") {
		islandCapture = { islands: [] };
		tree = h(IslandCaptureContext.Provider, { value: islandCapture }, tree);
	}
	const body = await renderToString(tree);
	if (hydration !== "full") {
		const islandFiles = [...new Set((islandCapture?.islands ?? []).map((usage) => usage.descriptor.file))];
		let islandsEntryUrl;
		if (hydration === "islands" && (islandFiles.length > 0 || options.options.islandsBootstrapRequired === true)) {
			islandsEntryUrl = options.options.islandsEntryUrl ?? getIslandsClientEntryUrl();
			if (!islandsEntryUrl) throw new Error(`Route "${options.routeArgs.route.path}" uses hydration: "islands" and requires the islands bootstrap${islandFiles.length > 0 ? ` for ${islandFiles.length} island(s) in its error boundary` : " for a page-level runtime projection"}, but no bootstrap URL is registered. ` + (islandFiles.length > 0 ? "This usually means the @pracht/vite-plugin islands entry was not built — check that your islands live in the configured islands directory." : "This usually means generated page-runtime metadata was not forwarded by the deployment adapter."));
		}
		const preloadFiles = new Set((islandCapture?.islands ?? []).filter((usage) => usage.strategy === "load").map((usage) => usage.descriptor.file));
		const islandPreloadUrls = /* @__PURE__ */ new Set();
		if (options.options.jsManifest) for (const file of preloadFiles) for (const url of resolveManifestEntries(options.options.jsManifest, file) ?? []) islandPreloadUrls.add(url);
		return htmlResponse(buildHtmlDocument({
			head,
			body,
			clientEntryUrl: islandsEntryUrl,
			cssUrls,
			modulePreloadUrls: islandsEntryUrl ? mergeEntryPreloadUrls(options.options.jsManifest, ISLANDS_ENTRY_MANIFEST_KEY, [...islandPreloadUrls]) : [...islandPreloadUrls]
		}), routeErrorWithDiagnostics.status, documentHeaders);
	}
	return htmlResponse(buildHtmlDocument({
		head,
		body,
		hydrationState: {
			url: options.requestPath,
			routeId: options.routeId,
			data: null,
			error: routeErrorWithDiagnostics
		},
		clientEntryUrl: options.options.clientEntryUrl,
		cssUrls,
		modulePreloadUrls
	}), routeErrorWithDiagnostics.status, documentHeaders);
}
//#endregion
export { getRenderToReadableStream, getRenderToStringAsync, isFrameworkFontHeadResponse, jsonErrorResponse, markFrameworkFontHeadResponse, normalizePageResponse, renderApiErrorResponse, renderRouteErrorResponse };
