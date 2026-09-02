import { withBase } from "./base.mjs";
import { NOT_FOUND_ROUTE_ID, ROUTE_STATE_REQUEST_HEADER } from "./runtime-constants.mjs";
import { buildPathFromSegments } from "./route-matching.mjs";
import { resolveApp } from "./app.mjs";
import { resolveRegistryModule } from "./runtime-manifest.mjs";
import { routeNeedsServerFetch } from "./runtime-client-fetch.mjs";
import { buildHtmlDocument } from "./runtime-html.mjs";
import { hasMarkdownRepresentation } from "./runtime-negotiation.mjs";
import { handlePrachtRequest } from "./runtime.mjs";
import { isDangerousPrerenderHeader, normalizeRouteRevalidate } from "./revalidation.mjs";
//#region src/prerender.ts
async function prerenderApp(options) {
	const resolved = resolveApp(options.app);
	const results = [];
	const isgManifest = {};
	const generatedAt = Date.now();
	let failedPrerenders = 0;
	let firstPrerenderError;
	const work = [];
	for (const route of resolved.routes) {
		const render = route.render;
		if (render !== "ssg" && render !== "isg" && !(options.staticExport === true && render === "spa")) continue;
		const paths = await collectSSGPaths(route, options.registry, options.staticExport === true);
		for (const pathname of paths) {
			if (render === "isg" && route.revalidate) normalizeRouteRevalidate(route.revalidate);
			work.push({
				pathname,
				render,
				revalidate: route.revalidate,
				route
			});
		}
	}
	const concurrency = options.concurrency ?? 10;
	if (!Number.isInteger(concurrency) || concurrency <= 0) throw new Error("prerenderApp({ concurrency }) expects a positive integer.");
	for (let i = 0; i < work.length; i += concurrency) {
		const batch = work.slice(i, i + concurrency);
		const batchResults = await Promise.all(batch.map(async (item) => {
			const url = new URL(withBase(item.pathname), "http://localhost");
			const request = new Request(url, { method: "GET" });
			let renderError;
			const [response, routeModule] = await Promise.all([handlePrachtRequest({
				app: options.app,
				request,
				registry: options.registry,
				clientEntryUrl: options.clientEntryUrl,
				islandsEntryUrl: options.islandsEntryUrl,
				islandsBootstrapRequired: options.islandsBootstrapRequired,
				cssManifest: options.cssManifest,
				jsManifest: options.jsManifest,
				onRouteError: (error) => {
					renderError = error;
				}
			}), resolveRegistryModule(options.registry?.routeModules, item.route.file)]);
			if (response.status !== 200) {
				if (options.staticExport === true) {
					const location = response.headers.get("location");
					const redirectDetail = location ? ` (redirect: ${location})` : "";
					throw new Error(`Static export failed to render ${item.render.toUpperCase()} route "${item.pathname}": document request returned status ${response.status}${redirectDetail}. A static build cannot preserve request-time redirects or failures; make the loader succeed at build time or use a serverful adapter.` + describeRenderError(renderError), renderError === void 0 ? void 0 : { cause: renderError });
				}
				console.warn(`  Warning: ${item.render.toUpperCase()} route "${item.pathname}" returned status ${response.status}, skipping.`);
				failedPrerenders++;
				if (firstPrerenderError === void 0 && renderError !== void 0) firstPrerenderError = renderError;
				return null;
			}
			if (options.staticExport === true) {
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentType.toLowerCase().includes("text/html")) throw new Error(`Static export failed to render ${item.render.toUpperCase()} route "${item.pathname}" as HTML (content-type: ${contentType || "missing"}). Page loaders must return serializable data instead of a successful non-HTML Response.`);
			}
			assertSafePrerenderHeaders(response.headers, item);
			const html = await response.text();
			let routeState;
			if (options.staticExport === true && item.route.hydration !== "islands" && item.route.hydration !== "none" && routeNeedsServerFetch(item.route)) {
				let stateError;
				const stateResponse = await handlePrachtRequest({
					app: options.app,
					request: new Request(url, {
						method: "GET",
						headers: { [ROUTE_STATE_REQUEST_HEADER]: "1" }
					}),
					registry: options.registry,
					onRouteError: (error) => {
						stateError = error;
					}
				});
				if (stateResponse.status === 200) {
					routeState = await stateResponse.text();
					try {
						const parsed = JSON.parse(routeState);
						if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected a JSON object");
					} catch {
						throw new Error(`Static export failed to serialize route state for "${item.pathname}": route-state request returned invalid JSON. Page loaders must return serializable data instead of a custom route-state Response.`);
					}
				} else {
					if (options.staticExport === true) {
						const location = stateResponse.headers.get("location");
						const redirectDetail = location ? ` (redirect: ${location})` : "";
						throw new Error(`Static export failed to serialize route state for "${item.pathname}": route-state request returned status ${stateResponse.status}${redirectDetail}. Make the loader succeed at build time or use a serverful adapter.` + describeRenderError(stateError), stateError === void 0 ? void 0 : { cause: stateError });
					}
					console.warn(`  Warning: route-state render for "${item.pathname}" returned status ${stateResponse.status}; no static state file will be written.`);
				}
			}
			return {
				headers: Object.fromEntries(response.headers),
				html,
				item,
				markdown: hasMarkdownRepresentation(item.route, routeModule),
				routeState
			};
		}));
		for (const result of batchResults) {
			if (!result) continue;
			results.push({
				path: result.item.pathname,
				html: result.html,
				headers: result.headers,
				markdown: result.markdown,
				...result.routeState !== void 0 ? { routeState: result.routeState } : {},
				...result.item.render === "spa" ? { spa: true } : {}
			});
			if (result.item.render === "isg" && result.item.revalidate) isgManifest[result.item.pathname] = {
				generatedAt,
				revalidate: result.item.revalidate
			};
		}
	}
	if (work.length > 0 && failedPrerenders === work.length) throw new Error(`No SSG/ISG pages were prerendered: all ${failedPrerenders} attempted ${failedPrerenders === 1 ? "render" : "renders"} returned a non-200 response. Refusing to finish a build with empty prerender output. Fix the build-time loader or render failures, or move request-dependent routes to SSR.` + describeRenderError(firstPrerenderError), firstPrerenderError === void 0 ? void 0 : { cause: firstPrerenderError });
	if (options.withISGManifest) return {
		pages: results,
		isgManifest
	};
	return results;
}
/**
* Render errors are deliberately opaque in the response body, which leaves a
* failing static build with a bare status and nothing to act on. Append the
* real message so `pracht build` names the cause instead of only the symptom.
*/
function describeRenderError(error) {
	if (error === void 0 || error === null) return "";
	const trimmed = (error instanceof Error ? error.message : String(error)).trim();
	return trimmed === "" ? "" : `\n\n  Underlying error: ${trimmed}`;
}
function assertSafePrerenderHeaders(headers, item) {
	const dangerous = [...headers.keys()].filter(isDangerousPrerenderHeader);
	if (dangerous.length === 0) return;
	const names = dangerous.map((name) => `"${name}"`).join(", ");
	throw new Error(`Refusing to prerender ${item.render.toUpperCase()} route "${item.pathname}" because its document headers include ${names}. SSG/ISG document headers are serialized into public static output and replayed for every visitor. Move cookies/authentication headers to API routes, loaders, middleware responses, or SSR-only routes.`);
}
async function collectSSGPaths(route, registry, staticExport = false) {
	if (!route.segments.some((s) => s.type === "param" || s.type === "catchall")) return [route.path];
	const routeModule = await resolveRegistryModule(registry?.routeModules, route.file);
	if (!routeModule?.getStaticPaths) {
		if (route.render === "spa") console.warn(`  Note: dynamic SPA route "${route.path}" has no getStaticPaths() export, so no document or state file is prerendered for it. In-app navigation renders it client-side (without loader data); deep links need staticAdapter({ fallback: "200.html" }) plus a host rewrite.`);
		else {
			if (staticExport) throw new Error(`Static export cannot emit dynamic SSG route "${route.path}" because it has no getStaticPaths() export. Add getStaticPaths() to enumerate every output path or use a serverful adapter.`);
			console.warn(`  Warning: ${(route.render ?? "ssg").toUpperCase()} route "${route.path}" has dynamic segments but no getStaticPaths() export, skipping.`);
		}
		return [];
	}
	return (await routeModule.getStaticPaths()).map((params) => buildPathFromSegments(route.segments, params));
}
/**
* The static-export SPA fallback document (conventionally `200.html`).
*
* A static host configured to rewrite unmatched URLs to this file (GitHub
* Pages cannot; Netlify/nginx/S3+CloudFront can) lets deep links to
* non-prerendered paths — dynamic `render: "spa"` routes above all — boot the
* client router, which resolves the real route from `window.location` (see
* the `fallback` hydration-state marker). The body is deliberately empty:
* this document is served for *any* URL, so no route- or shell-specific
* markup can be correct here.
*
* `head` is likewise explicit metadata shared by every rewritten URL. The
* build cannot run a route-specific `head()` function for an arbitrary path.
*
* `notFoundData` and `notFoundError` are copied from the already-rendered
* `404.html` hydration state. If the fallback resolves an unknown URL instead
* of a dynamic SPA route, the not-found component or error boundary therefore
* sees its normal build-time state without executing the loader a second time.
*/
function buildStaticFallbackHtml(options = {}) {
	return buildHtmlDocument({
		head: options.head ?? {},
		body: "",
		hydrationState: {
			url: "/",
			routeId: NOT_FOUND_ROUTE_ID,
			data: options.notFoundData,
			error: options.notFoundError ?? null,
			pending: true,
			fallback: true
		},
		clientEntryUrl: options.clientEntryUrl
	});
}
//#endregion
export { buildStaticFallbackHtml, describeRenderError, prerenderApp };
