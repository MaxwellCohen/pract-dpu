import { withBase } from "./base.mjs";
import { PREFETCH_ATTRIBUTE, PRESERVE_SCROLL_ATTRIBUTE, SAFE_METHODS, SPECULATE_ATTRIBUTE, VIEW_TRANSITION_ATTRIBUTE } from "./runtime-constants.mjs";
import { buildHrefUntyped } from "./route-matching.mjs";
import { formDataToRecord, isApiValidationErrorBody, validateStandardSchema } from "./api-validation.mjs";
import { navigateToClientLocation, parseSafeNavigationUrl } from "./runtime-client-fetch.mjs";
import { RouteDataContext } from "./runtime-context.mjs";
import { revalidateRouteData } from "./runtime-revalidate.mjs";
import { ensureCapabilityRevalidation } from "./runtime-capability-revalidate.mjs";
import { beginSubmittingNavigation, createNavigationLocation, getNavigation, settleNavigation, subscribeToNavigation } from "./navigation-state.mjs";
import { clearPrefetchCache } from "./prefetch-cache.mjs";
import { CAPABILITY_EFFECT_HEADER, CAPABILITY_FORM_REDIRECT_HEADER, CAPABILITY_FORM_REQUEST_HEADER, CAPABILITY_SETTLED_EVENT, capabilityHttpPath } from "@pracht/capabilities";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { h } from "preact";
//#region src/runtime-hooks.ts
const validatedNativeSubmissions = /* @__PURE__ */ new WeakSet();
var PrachtReadonlyURLSearchParams = class extends URLSearchParams {
	#mutationError = "useSearchParams() is read-only. Navigate to a new URL to change the query string.";
	append(_name, _value) {
		throw new TypeError(this.#mutationError);
	}
	delete(_name, _value) {
		throw new TypeError(this.#mutationError);
	}
	set(_name, _value) {
		throw new TypeError(this.#mutationError);
	}
	sort() {
		throw new TypeError(this.#mutationError);
	}
};
function useRouteData(routeId) {
	const runtime = useContext(RouteDataContext);
	if (import.meta.env?.DEV && routeId !== void 0 && runtime && runtime.routeId !== routeId) console.warn(`useRouteData("${routeId}") rendered inside route "${runtime.routeId}"; returning the active route's data.`);
	return runtime?.data;
}
function useLocation() {
	return parseLocation(useContext(RouteDataContext)?.url ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/"));
}
/** Read the current URL search parameters reactively. */
function useSearchParams() {
	const { search } = useLocation();
	return useMemo(() => new PrachtReadonlyURLSearchParams(search), [search]);
}
function useParams() {
	return useContext(RouteDataContext)?.params ?? {};
}
function useRevalidate() {
	const runtime = useContext(RouteDataContext);
	return () => revalidateRouteData(runtime);
}
/**
* Reactive pending state for the current client navigation or `<Form>`
* submission. Returns `{ state: "idle" }` when nothing is in flight,
* `{ state: "loading", location }` while the router fetches and commits a
* navigation, and `{ state: "submitting", location, formData }` while a
* `<Form>` submission is awaiting its response. During SSR it always
* returns the idle state.
*/
function useNavigation() {
	const [navigation, setNavigation] = useState(getNavigation);
	useEffect(() => {
		setNavigation(getNavigation());
		return subscribeToNavigation(setNavigation);
	}, []);
	return navigation;
}
function Link(props) {
	const routes = useContext(RouteDataContext)?.routes ?? globalThis.__PRACHT_ROUTE_DEFINITIONS__;
	if (!routes) throw new Error("<Link route=...> must render inside a pracht route tree.");
	const { route, params, search, hash, prefetch, preserveScroll, viewTransition, speculate, href, ...anchorProps } = props;
	if (import.meta.env?.DEV !== false && (typeof route !== "string" || href !== void 0)) throw new Error("<Link> navigates by route id, not href: use a generated route id with <Link route={routeId}> (with `params` for dynamic segments), or a plain <a href> for external and user-provided URLs.");
	return h("a", {
		...anchorProps,
		href: buildHrefUntyped(routes, route, {
			params,
			search,
			hash
		}),
		[PREFETCH_ATTRIBUTE]: prefetch,
		[PRESERVE_SCROLL_ATTRIBUTE]: preserveScroll ? "" : void 0,
		[VIEW_TRANSITION_ATTRIBUTE]: viewTransition ? "" : void 0,
		[SPECULATE_ATTRIBUTE]: speculate === void 0 ? void 0 : speculate ? "on" : "off"
	});
}
function Form(props) {
	const { onSubmit, method, action, capability, onCapabilityResult, schema, onValidationIssues, onResponse, ...rest } = props;
	const actionAttribute = capability ? withBase(action ?? capabilityHttpPath(capability)) : action;
	return h("form", {
		...rest,
		method: capability ? "post" : method,
		action: actionAttribute,
		onSubmit: async (event) => {
			const form = event.currentTarget;
			if (!(form instanceof HTMLFormElement)) return;
			if (validatedNativeSubmissions.delete(form)) return;
			onSubmit?.(event);
			if (event.defaultPrevented) return;
			const submitter = typeof SubmitEvent !== "undefined" && event instanceof SubmitEvent ? event.submitter : null;
			const nativeSubmitter = (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) && submitter.form === form ? submitter : void 0;
			if (capability) {
				ensureCapabilityRevalidation();
				const endpoint = nativeSubmitter?.getAttribute("formaction") ?? actionAttribute ?? form.action;
				const endpointUrl = parseSafeNavigationUrl(endpoint, window.location.href);
				if (!endpointUrl) {
					event.preventDefault();
					console.error(`[pracht] refused to submit capability form to unsafe URL: ${endpoint}`);
					return;
				}
				const isCrossOriginEndpoint = endpointUrl.origin !== window.location.origin;
				if (isCrossOriginEndpoint && !schema) return;
				event.preventDefault();
				const formData = new FormData(form, nativeSubmitter);
				if (schema) {
					const result = await validateStandardSchema(schema, formDataToRecord(formData), "body");
					if (result.issues) {
						onValidationIssues?.(result.issues);
						return;
					}
				}
				if (isCrossOriginEndpoint) {
					validatedNativeSubmissions.add(form);
					try {
						form.requestSubmit(nativeSubmitter);
					} finally {
						validatedNativeSubmissions.delete(form);
					}
					return;
				}
				clearPrefetchCache();
				const navigationToken = beginSubmittingNavigation(createNavigationLocation(endpoint), formData);
				let envelope;
				let response;
				try {
					response = await fetch(endpoint, {
						method: "POST",
						body: formData,
						credentials: "same-origin",
						headers: { [CAPABILITY_FORM_REQUEST_HEADER]: "1" }
					});
					const enhancedRedirect = response.headers.get(CAPABILITY_FORM_REDIRECT_HEADER);
					if (enhancedRedirect || response.redirected || response.status >= 300 && response.status < 400) {
						await navigateToClientLocation(enhancedRedirect ?? (response.redirected ? response.url : response.headers.get("location")) ?? endpoint, { reloadRouteState: true });
						return;
					}
					try {
						envelope = await response.clone().json();
					} catch {
						envelope = {
							ok: false,
							error: {
								code: "invalid_response",
								message: `Capability endpoint returned a non-JSON response (status ${response.status}).`
							}
						};
					}
				} catch (error) {
					envelope = {
						ok: false,
						error: {
							code: "network_error",
							message: error instanceof Error ? error.message : String(error)
						}
					};
				} finally {
					settleNavigation(navigationToken);
				}
				if (response) onResponse?.(response);
				if (envelope.ok) form.reset();
				window.dispatchEvent(new CustomEvent(CAPABILITY_SETTLED_EVENT, { detail: {
					name: capability,
					ok: envelope.ok,
					effect: response?.headers.get(CAPABILITY_EFFECT_HEADER) ?? null
				} }));
				onCapabilityResult?.(envelope);
				return;
			}
			const formMethod = ((nativeSubmitter?.getAttribute("formmethod") || void 0) ?? method ?? form.method ?? "post").toUpperCase();
			const isSafeMethod = SAFE_METHODS.has(formMethod);
			if (isSafeMethod && !schema) return;
			const actionUrl = nativeSubmitter?.getAttribute("formaction") ?? action ?? form.action;
			const actionTarget = parseSafeNavigationUrl(actionUrl, window.location.href);
			const isCrossOriginAction = actionTarget !== null && actionTarget.origin !== window.location.origin;
			if (isCrossOriginAction && !schema) return;
			event.preventDefault();
			const formData = new FormData(form, nativeSubmitter);
			if (schema) {
				const result = await validateStandardSchema(schema, formDataToRecord(formData), "body");
				if (result.issues) {
					onValidationIssues?.(result.issues);
					return;
				}
			}
			if (isSafeMethod || isCrossOriginAction) {
				validatedNativeSubmissions.add(form);
				try {
					form.requestSubmit(nativeSubmitter);
				} finally {
					validatedNativeSubmissions.delete(form);
				}
				return;
			}
			clearPrefetchCache();
			const navigationToken = beginSubmittingNavigation(createNavigationLocation(actionUrl), formData);
			try {
				const response = await fetch(actionUrl, {
					method: formMethod,
					body: formData,
					credentials: "same-origin",
					headers: { [CAPABILITY_FORM_REQUEST_HEADER]: "1" }
				});
				const enhancedRedirect = response.headers.get(CAPABILITY_FORM_REDIRECT_HEADER);
				if (enhancedRedirect || response.redirected || response.status >= 300 && response.status < 400) await navigateToClientLocation(enhancedRedirect ?? (response.redirected ? response.url : response.headers.get("location")) ?? actionUrl, { reloadRouteState: true });
				else {
					if ((response.status === 400 || response.status === 422) && onValidationIssues) {
						const body = await response.clone().json().catch(() => null);
						if (isApiValidationErrorBody(body)) onValidationIssues(body.issues);
					}
					onResponse?.(response);
				}
			} finally {
				settleNavigation(navigationToken);
			}
		}
	});
}
function parseLocation(value) {
	const url = new URL(value, "http://pracht.local");
	return {
		pathname: url.pathname,
		search: url.search
	};
}
//#endregion
export { Form, Link, useLocation, useNavigation, useParams, useRevalidate, useRouteData, useSearchParams };
