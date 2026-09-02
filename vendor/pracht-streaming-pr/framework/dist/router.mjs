import { stripBase } from "./base.mjs";
import { PRESERVE_SCROLL_ATTRIBUTE } from "./runtime-constants.mjs";
import { buildHrefUntyped, matchResolvedRoute } from "./route-matching.mjs";
import { IS_STATIC_TARGET } from "./runtime-static.mjs";
import { fetchPrachtRouteState, parseSafeNavigationUrl, routeNeedsServerFetch } from "./runtime-client-fetch.mjs";
import { deserializeRouteError } from "./runtime-errors.mjs";
import { PrachtRuntimeProvider, RouteDataContext } from "./runtime-context.mjs";
import { applyFontHeadFragments } from "./runtime-fonts.mjs";
import { markHydrating, onHydrationComplete } from "./hydration.mjs";
import { normalizeCaughtError } from "./error-boundary.mjs";
import { beginLoadingNavigation, createNavigationLocation, settleNavigation } from "./navigation-state.mjs";
import { getCachedRouteState } from "./prefetch-cache.mjs";
import { isSpeculationSuppressed, normalizeSpeculation, supportsSpeculationRules } from "./runtime-speculation.mjs";
import { registerPrefetchTarget } from "./prefetch-api.mjs";
import { decodeFragmentId, findFragmentTarget, focusFragmentTarget, scrollToFragmentTarget } from "./fragment-navigation.mjs";
import { installHydrationMismatchWarning } from "./hydration-mismatch.mjs";
import { createScrollPositionStore, generateScrollKey, getSessionScrollStorage, readScrollKeyFromHistoryState, withScrollKeyInHistoryState } from "./scroll-restoration.mjs";
import { useContext, useLayoutEffect, useMemo, useState } from "preact/hooks";
import { Component, createContext, h, hydrate, render } from "preact";
//#region src/router.ts
const PREFETCH_ENABLED = typeof __PRACHT_CLIENT_PREFETCH__ === "undefined" || __PRACHT_CLIENT_PREFETCH__ !== false;
var RouteErrorBoundary = class extends Component {
	state = { error: null };
	componentDidCatch(error) {
		if (typeof error?.then === "function") throw error;
		this.setState({ error: normalizeCaughtError(error) });
	}
	render(props, state) {
		return state.error === null ? props.children : h(props.Boundary, { error: state.error });
	}
};
const NavigateContext = createContext(async () => {});
function useNavigate() {
	return useContext(NavigateContext);
}
async function initClientRouter(options) {
	const { app, routeModules, shellModules, root, findModuleKey } = options;
	const moduleCache = /* @__PURE__ */ new Map();
	function loadModule(modules, key) {
		let cached = moduleCache.get(key);
		if (!cached) {
			cached = modules[key]();
			moduleCache.set(key, cached);
		}
		return cached;
	}
	function startRouteImport(match) {
		const routeKey = findModuleKey(routeModules, match.route.file);
		if (!routeKey) return null;
		return loadModule(routeModules, routeKey);
	}
	function startShellImport(match) {
		if (!match.route.shellFile) return null;
		const shellKey = findModuleKey(shellModules, match.route.shellFile);
		if (!shellKey) return null;
		return loadModule(shellModules, shellKey);
	}
	let updateRouteState = null;
	let routeStateVersion = 0;
	let activeRouteStateVersion = 0;
	let latestNavigationId = 0;
	let activeNavigationAbort = null;
	const scrollStore = createScrollPositionStore(getSessionScrollStorage());
	if ("scrollRestoration" in history) history.scrollRestoration = "manual";
	let currentScrollKey = readScrollKeyFromHistoryState(history.state) ?? "";
	const hadExistingScrollKey = currentScrollKey !== "";
	if (!hadExistingScrollKey) {
		currentScrollKey = generateScrollKey();
		try {
			history.replaceState(withScrollKeyInHistoryState(history.state, currentScrollKey), "", window.location.href);
		} catch {}
	}
	function saveScrollPosition() {
		scrollStore.set(currentScrollKey, {
			x: window.scrollX,
			y: window.scrollY
		});
	}
	window.addEventListener("pagehide", saveScrollPosition);
	let currentDocumentPath = window.location.pathname + window.location.search;
	function restoreOrResetScroll(opts, browserUrl) {
		if (opts?.preserveScroll) return;
		if (opts?._popstate) {
			const saved = scrollStore.get(currentScrollKey);
			if (saved) {
				window.scrollTo(saved.x, saved.y);
				return;
			}
		}
		const hashIndex = browserUrl.indexOf("#");
		if (hashIndex !== -1) {
			const hashTarget = findFragmentTarget(document, browserUrl.slice(hashIndex));
			if (hashTarget) {
				scrollToFragmentTarget(hashTarget);
				return;
			}
		}
		window.scrollTo(0, 0);
	}
	/**
	* Scroll to (and focus) a fragment the way a browser would.
	*
	* When nothing matches there is no indicated part to scroll to: the browser
	* goes to the top of the document only for the empty fragment and the
	* legacy `#top`, and stays exactly where it is otherwise.
	*/
	function scrollToFragment(hash) {
		const target = findFragmentTarget(document, hash);
		if (target) {
			scrollToFragmentTarget(target);
			return;
		}
		const id = decodeFragmentId(hash);
		if (id === "" || id.toLowerCase() === "top") window.scrollTo(0, 0);
	}
	/**
	* Commit an in-page fragment navigation from a link click.
	*
	* The browser does this itself, but only the first time. Clicking a link to
	* the fragment you are already at reuses the current history entry instead
	* of pushing a new one, and `popstate` alone cannot tell that reuse apart
	* from a back/forward traversal — the entry already carries a scroll key, so
	* the router would read it as a traversal and restore the position saved for
	* it, undoing the browser's jump. (The Navigation API's `navigationType`
	* would separate the two, but it is not available everywhere.)
	*
	* Owning the whole interaction here makes a repeat click scroll every time
	* and leaves `popstate` to mean "traversal", which is what the scroll-key
	* logic assumes. The guard in the popstate handler stays as the fallback for
	* fragment entries created some other way (`location.hash = …`).
	*/
	function commitFragmentNavigation(url, preserveScroll) {
		const previousUrl = window.location.href;
		if (url.href !== previousUrl) {
			saveScrollPosition();
			const nextScrollKey = generateScrollKey();
			try {
				history.pushState(withScrollKeyInHistoryState(null, nextScrollKey), "", url.pathname + url.search + url.hash);
				currentScrollKey = nextScrollKey;
			} catch {}
		}
		currentDocumentPath = url.pathname + url.search;
		if (!preserveScroll) scrollToFragment(url.hash);
		const nextUrl = window.location.href;
		if (nextUrl !== previousUrl) dispatchHashChange(previousUrl, nextUrl);
	}
	let afterCommitCallback = null;
	function RouteComponent({ Component, componentProps }) {
		const runtime = useContext(RouteDataContext);
		return h(Component, runtime && "data" in componentProps ? {
			...componentProps,
			data: runtime.data
		} : componentProps);
	}
	function RouterRoot({ initialState }) {
		const [routeState, setRouteState] = useState(initialState);
		updateRouteState = setRouteState;
		const navigateValue = useMemo(() => navigate, []);
		const { Shell, Component, ErrorBoundaries, componentProps, data, params, routeId, url, version } = routeState;
		const [RouteBoundary, ShellBoundary] = ErrorBoundaries;
		activeRouteStateVersion = version;
		useLayoutEffect(() => {
			if (!afterCommitCallback) return;
			const callback = afterCommitCallback;
			afterCommitCallback = null;
			callback();
		}, [version]);
		const routeElement = h(RouteComponent, {
			Component,
			componentProps
		});
		const guardedRouteElement = RouteBoundary ? h(RouteErrorBoundary, {
			key: version,
			Boundary: RouteBoundary,
			children: routeElement
		}) : routeElement;
		const shellTree = Shell ? h(Shell, null, guardedRouteElement) : guardedRouteElement;
		const componentTree = ShellBoundary ? h(RouteErrorBoundary, {
			key: version,
			Boundary: ShellBoundary,
			children: shellTree
		}) : shellTree;
		return h(NavigateContext.Provider, { value: navigateValue }, h(PrachtRuntimeProvider, {
			data,
			params,
			routeId,
			routes: app.routes,
			stateVersion: version,
			url,
			isCurrent: () => activeRouteStateVersion === version
		}, componentTree));
	}
	function applyRouteState(routeState) {
		activeRouteStateVersion = routeState.version;
		if (updateRouteState) {
			updateRouteState(routeState);
			return;
		}
		render(h(RouterRoot, { initialState: routeState }), root);
	}
	async function resolveRouteState(match, state, currentUrl, routeModPromise, shellModPromise) {
		const routeMod = await (routeModPromise ?? startRouteImport(match));
		if (!routeMod) return null;
		let Shell = null;
		const resolvedShell = await (shellModPromise ?? startShellImport(match));
		if (resolvedShell) Shell = resolvedShell.Shell;
		const DefaultComponent = typeof routeMod.default === "function" ? routeMod.default : void 0;
		const RouteBoundary = routeMod.ErrorBoundary;
		const ShellBoundary = resolvedShell?.ErrorBoundary;
		const ErrorBoundary = RouteBoundary ?? ShellBoundary;
		const Component = state.error ? ErrorBoundary : routeMod.Component ?? DefaultComponent;
		if (!Component) return null;
		const componentProps = state.error ? { error: deserializeRouteError(state.error) } : {
			data: state.data,
			params: match.params
		};
		return {
			Shell,
			Component,
			ErrorBoundaries: state.error ? [null, null] : [RouteBoundary ?? null, ShellBoundary ?? null],
			componentProps,
			data: state.data,
			params: match.params,
			routeId: match.route.id ?? "",
			url: currentUrl,
			version: ++routeStateVersion
		};
	}
	async function resolveSpaPendingState(match, currentUrl, shellModPromise) {
		const resolvedShell = await (shellModPromise ?? startShellImport(match));
		if (!resolvedShell) return null;
		const Shell = resolvedShell.Shell ?? null;
		const Loading = resolvedShell.Loading;
		if (!Shell && !Loading) return null;
		return {
			Shell,
			Component: Loading ?? (() => null),
			ErrorBoundaries: [null, null],
			componentProps: {},
			data: void 0,
			params: match.params,
			routeId: match.route.id ?? "",
			url: currentUrl,
			version: ++routeStateVersion
		};
	}
	function resolveRedirectTarget(location) {
		const targetUrl = parseSafeNavigationUrl(location, window.location.href);
		if (!targetUrl) return {
			isCurrentLocation: false,
			unsafe: true
		};
		const fullInternalTarget = targetUrl.pathname + targetUrl.search + targetUrl.hash;
		const internalPath = targetUrl.pathname + targetUrl.search;
		const currentPath = window.location.pathname + window.location.search + window.location.hash;
		const isCurrentLocation = targetUrl.origin === window.location.origin && fullInternalTarget === currentPath;
		if (targetUrl.origin !== window.location.origin) return {
			externalUrl: targetUrl.toString(),
			isCurrentLocation: false
		};
		if (targetUrl.hash) return {
			documentUrl: targetUrl.toString(),
			isCurrentLocation
		};
		return {
			internalPath,
			isCurrentLocation
		};
	}
	async function navigate(to, opts) {
		const navigationId = ++latestNavigationId;
		activeNavigationAbort?.abort();
		const abortController = new AbortController();
		activeNavigationAbort = abortController;
		const navigationTarget = typeof to === "string" ? to : buildHrefUntyped(app.routes, to.route, to);
		const target = resolveBrowserRouteTarget(navigationTarget);
		if (!target) {
			const safeUrl = parseSafeNavigationUrl(navigationTarget, window.location.href);
			if (safeUrl) window.location.href = safeUrl.toString();
			else if (navigationTarget) console.error(`[pracht] refused to navigate to unsafe URL: ${navigationTarget}`);
			return;
		}
		const match = matchResolvedRoute(app, target.pathname);
		if (!match) {
			window.location.href = target.browserUrl;
			return;
		}
		if (match.route.hydration === "islands" || match.route.hydration === "none") {
			window.location.href = target.browserUrl;
			return;
		}
		const navigationToken = beginLoadingNavigation(createNavigationLocation(target.browserUrl));
		try {
			let statePromise;
			if (routeNeedsServerFetch(match.route)) statePromise = opts?._reloadRouteState ? fetchPrachtRouteState(target.requestUrl, {
				cache: "reload",
				signal: abortController.signal
			}) : (PREFETCH_ENABLED ? getCachedRouteState(target.requestUrl) : void 0) ?? fetchPrachtRouteState(target.requestUrl, { signal: abortController.signal });
			else statePromise = Promise.resolve({
				type: "data",
				data: void 0,
				fontHead: {
					preloadLinks: [],
					css: ""
				}
			});
			const routeModPromise = startRouteImport(match);
			const shellModPromise = startShellImport(match);
			let state = {
				data: void 0,
				error: null
			};
			let fontHead = match.route.hasHead === false ? {
				preloadLinks: [],
				css: ""
			} : void 0;
			try {
				const result = await statePromise;
				if (navigationId !== latestNavigationId) return;
				if (result.type === "redirect") {
					if (result.location) {
						const redirect = resolveRedirectTarget(result.location);
						if (redirect.unsafe) {
							console.error(`[pracht] refused to navigate to unsafe URL: ${result.location}`);
							return;
						}
						if (redirect.externalUrl) {
							window.location.href = redirect.externalUrl;
							return;
						}
						if (redirect.isCurrentLocation) return;
						if (redirect.documentUrl) {
							window.location.href = redirect.documentUrl;
							return;
						}
						if (redirect.internalPath) {
							await navigate(redirect.internalPath, opts);
							return;
						}
						window.location.href = target.browserUrl;
						return;
					}
					window.location.href = target.browserUrl;
					return;
				}
				if (result.type === "error") {
					if (result.error.status === 404 && app.notFound) {
						if (!(await routeModPromise?.catch(() => null))?.ErrorBoundary) {
							window.location.href = target.browserUrl;
							return;
						}
					}
					state = {
						data: void 0,
						error: result.error
					};
					fontHead = result.fontHead ?? {
						preloadLinks: [],
						css: ""
					};
				} else {
					state = {
						data: result.data,
						error: null
					};
					if (result.fontHead) fontHead = result.fontHead;
				}
			} catch {
				if (abortController.signal.aborted || navigationId !== latestNavigationId) return;
				if (!(IS_STATIC_TARGET && (opts?._staticFallback || match.route.render === "spa"))) {
					window.location.href = target.browserUrl;
					return;
				}
				if (!opts?._staticFallback) fontHead = {
					preloadLinks: [],
					css: ""
				};
			}
			if (opts?._staticFallback) fontHead = void 0;
			if (navigationId !== latestNavigationId) return;
			if (!opts?._popstate) {
				saveScrollPosition();
				if (opts?.replace) history.replaceState(withScrollKeyInHistoryState(history.state, currentScrollKey), "", target.browserUrl);
				else {
					const nextScrollKey = generateScrollKey();
					history.pushState(withScrollKeyInHistoryState(null, nextScrollKey), "", target.browserUrl);
					currentScrollKey = nextScrollKey;
				}
				const hashIndex = target.browserUrl.indexOf("#");
				currentDocumentPath = hashIndex === -1 ? target.browserUrl : target.browserUrl.slice(0, hashIndex);
			}
			const routeState = await resolveRouteState(match, state, target.requestUrl, routeModPromise, shellModPromise);
			if (navigationId !== latestNavigationId) return;
			if (!routeState) {
				window.location.href = target.browserUrl;
				return;
			}
			const commit = () => {
				afterCommitCallback = () => restoreOrResetScroll(opts, target.browserUrl);
				if (fontHead) applyFontHeadFragments(fontHead);
				applyRouteState(routeState);
			};
			await commitWithOptionalViewTransition(commit, opts?.viewTransition ?? app.viewTransitions === true);
		} finally {
			settleNavigation(navigationToken);
		}
	}
	const isStaticFallbackBoot = IS_STATIC_TARGET && options.initialState.fallback === true;
	const isStaticNotFoundDocument = IS_STATIC_TARGET && !isStaticFallbackBoot && options.initialState.routeId === "__pracht_not_found__";
	const initialStateUrl = options.initialState.url;
	const initialTarget = resolveBrowserRouteTarget(initialStateUrl);
	const initialRequestUrl = initialTarget?.requestUrl ?? initialStateUrl;
	const initialBrowserUrl = initialTarget?.browserUrl ?? initialStateUrl;
	const initialPathname = initialTarget?.pathname ?? initialStateUrl;
	const hydrationBrowserTarget = resolveBrowserRouteTarget(window.location.pathname + window.location.search + window.location.hash);
	const initialMatch = isStaticFallbackBoot ? void 0 : isStaticNotFoundDocument && app.notFound ? {
		route: app.notFound,
		params: {},
		pathname: initialPathname
	} : matchResolvedRoute(app, initialPathname) ?? (options.initialState.routeId === "__pracht_not_found__" && app.notFound ? {
		route: app.notFound,
		params: {},
		pathname: initialPathname
	} : void 0);
	if (initialMatch) {
		const initialShellPromise = initialMatch.route.render === "spa" && options.initialState.pending ? startShellImport(initialMatch) : null;
		let state = {
			data: options.initialState.data,
			error: options.initialState.error ?? null
		};
		if (initialMatch.route.render === "spa" && options.initialState.pending) {
			const dataPromise = fetchPrachtRouteState(initialRequestUrl, { useDataParam: true });
			const pendingState = await resolveSpaPendingState(initialMatch, initialRequestUrl, initialShellPromise);
			if (pendingState) {
				if (import.meta.env?.DEV) installHydrationMismatchWarning();
				hydrate(h(RouterRoot, { initialState: pendingState }), root);
			}
			try {
				const result = await dataPromise;
				if (result.type === "redirect") {
					const safeRedirect = parseSafeNavigationUrl(result.location, window.location.href);
					if (!safeRedirect) {
						console.error(`[pracht] refused to navigate to unsafe URL: ${result.location}`);
						return;
					}
					window.location.href = safeRedirect.toString();
					return;
				}
				if (result.type === "error") {
					state = {
						data: void 0,
						error: result.error
					};
					applyFontHeadFragments(result.fontHead ?? {
						preloadLinks: [],
						css: ""
					});
				} else {
					state = {
						data: result.data,
						error: null
					};
					if (result.fontHead) applyFontHeadFragments(result.fontHead);
				}
			} catch {
				if (!IS_STATIC_TARGET) {
					window.location.href = initialBrowserUrl;
					return;
				}
				state = {
					data: void 0,
					error: null
				};
			}
			const resolvedState = await resolveRouteState(initialMatch, state, initialRequestUrl, void 0, initialShellPromise);
			if (resolvedState) applyRouteState(resolvedState);
		} else {
			const initialRouteState = await resolveRouteState(initialMatch, state, initialRequestUrl, void 0, initialShellPromise);
			if (initialRouteState) if (initialMatch.route.render === "spa") render(h(RouterRoot, { initialState: initialRouteState }), root);
			else {
				if (import.meta.env?.DEV) installHydrationMismatchWarning();
				markHydrating();
				hydrate(h(RouterRoot, { initialState: initialRouteState }), root);
				onHydrationComplete(() => {
					if (!hydrationBrowserTarget || !updateRouteState) return;
					updateRouteState((currentState) => {
						const hydratedTarget = isStaticNotFoundDocument ? hydrationBrowserTarget : resolveBrowserRouteTarget(currentState.url);
						if (!hydratedTarget) return currentState;
						const nextRequestUrl = hydratedTarget.urlPathname + hydrationBrowserTarget.search;
						if (currentState.version !== initialRouteState.version || currentState.url === nextRequestUrl) return currentState;
						return {
							...currentState,
							url: nextRequestUrl
						};
					});
				});
			}
		}
	}
	document.addEventListener("click", (e) => {
		const anchor = e.target.closest?.("a");
		if (!anchor) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		if (e.defaultPrevented) return;
		if (e.button !== 0) return;
		const target = anchor.getAttribute("target");
		if (target && target !== "_self") return;
		if (anchor.hasAttribute("download")) return;
		const href = anchor.getAttribute("href");
		if (!href) return;
		const isFragmentHref = href.startsWith("#");
		let url;
		try {
			url = new URL(href, window.location.href);
		} catch {
			return;
		}
		if (url.origin !== window.location.origin) return;
		if (url.pathname + url.search === window.location.pathname + window.location.search && (url.hash !== "" || isFragmentHref)) {
			e.preventDefault();
			commitFragmentNavigation(url, anchor.hasAttribute(PRESERVE_SCROLL_ATTRIBUTE));
			return;
		}
		const targetMatch = matchResolvedRoute(app, stripBase(url.pathname) ?? url.pathname);
		if (targetMatch && supportsSpeculationRules() && !isSpeculationSuppressed(anchor)) {
			if (normalizeSpeculation(targetMatch.route.speculation)?.mode === "prerender") return;
		}
		e.preventDefault();
		const navOptions = {};
		if (anchor.hasAttribute("data-pracht-preserve-scroll")) navOptions.preserveScroll = true;
		if (anchor.hasAttribute("data-pracht-view-transition")) navOptions.viewTransition = true;
		navigate(url.pathname + url.search + url.hash, navOptions);
	});
	window.addEventListener("popstate", () => {
		saveScrollPosition();
		let nextScrollKey = readScrollKeyFromHistoryState(history.state);
		const nextDocumentPath = window.location.pathname + window.location.search;
		const isFragmentNavigation = !nextScrollKey && nextDocumentPath === currentDocumentPath;
		if (!nextScrollKey) {
			nextScrollKey = generateScrollKey();
			try {
				history.replaceState(withScrollKeyInHistoryState(history.state, nextScrollKey), "", window.location.href);
			} catch {}
		}
		currentScrollKey = nextScrollKey;
		if (isFragmentNavigation) {
			const fragmentTarget = findFragmentTarget(document, window.location.hash);
			if (fragmentTarget) focusFragmentTarget(fragmentTarget);
			return;
		}
		currentDocumentPath = nextDocumentPath;
		navigate(window.location.pathname + window.location.search + window.location.hash, { _popstate: true });
	});
	window.__PRACHT_NAVIGATE__ = navigate;
	if (isStaticFallbackBoot) {
		const bootPath = window.location.pathname + window.location.search + window.location.hash;
		const bootMatch = matchResolvedRoute(app, stripBase(window.location.pathname) ?? "/");
		if (bootMatch != null && bootMatch.route.render === "spa" && bootMatch.route.hydration !== "islands" && bootMatch.route.hydration !== "none") await navigate(bootPath, {
			replace: true,
			_staticFallback: true
		});
		else if (app.notFound) {
			const notFoundState = await resolveRouteState({
				route: app.notFound,
				params: {},
				pathname: window.location.pathname
			}, {
				data: options.initialState.data,
				error: options.initialState.error ?? null
			}, window.location.pathname + window.location.search);
			if (notFoundState) applyRouteState(notFoundState);
		}
	}
	if (hadExistingScrollKey) {
		const savedPosition = scrollStore.get(currentScrollKey);
		if (savedPosition) window.scrollTo(savedPosition.x, savedPosition.y);
	}
	if (PREFETCH_ENABLED) {
		const warmModules = (match) => {
			startRouteImport(match);
			startShellImport(match);
		};
		registerPrefetchTarget(app, warmModules);
		try {
			const { setupPrefetching } = await import("./prefetch.mjs");
			setupPrefetching(app, warmModules);
		} catch (error) {
			console.warn("[pracht] Prefetching could not be initialized.", error);
		}
	}
	window.__PRACHT_ROUTER_READY__ = true;
	document.documentElement.setAttribute("data-pracht-hydrated", "true");
}
/**
* Fire the `hashchange` the platform would have fired for a fragment
* navigation the router intercepted. Both URLs are absolute, as the event's
* `oldURL`/`newURL` are specified to be.
*/
function dispatchHashChange(oldURL, newURL) {
	let event;
	try {
		event = new HashChangeEvent("hashchange", {
			oldURL,
			newURL
		});
	} catch {
		event = new Event("hashchange");
	}
	window.dispatchEvent(event);
}
/**
* Commit a navigation's DOM update, optionally wrapped in
* `document.startViewTransition()`. Falls back to a plain commit when view
* transitions are disabled or unsupported. Resolves once the DOM update has
* been applied (not when the transition animation finishes).
*/
async function commitWithOptionalViewTransition(commit, useViewTransition) {
	const doc = document;
	if (!useViewTransition || typeof doc.startViewTransition !== "function") {
		commit();
		return;
	}
	let committed = false;
	let transition;
	try {
		transition = doc.startViewTransition(async () => {
			committed = true;
			commit();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	} catch {}
	try {
		await transition?.updateCallbackDone;
	} catch {}
	if (!committed) commit();
}
function resolveBrowserRouteTarget(to) {
	if (typeof window === "undefined") return null;
	try {
		const url = new URL(to, window.location.href);
		if (url.origin !== window.location.origin) return null;
		const routePathname = stripBase(url.pathname);
		if (routePathname === null) return null;
		return {
			browserUrl: url.pathname + url.search + url.hash,
			pathname: routePathname,
			requestUrl: url.pathname + url.search,
			search: url.search,
			urlPathname: url.pathname
		};
	} catch {
		return null;
	}
}
//#endregion
export { initClientRouter, useNavigate };
