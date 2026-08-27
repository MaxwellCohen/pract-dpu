import { EMPTY_ROUTE_PARAMS, HYDRATION_STATE_ELEMENT_ID } from "./runtime-constants.mjs";
import { rehydrateDeferredData } from "./defer.mjs";
import { useEffect, useMemo, useState } from "preact/hooks";
import { createContext, h } from "preact";
//#region src/runtime-context.ts
const RouteDataContext = createContext(void 0);
/**
* Runtime values of every mounted provider, in mount order.
*
* Effect-driven revalidation (`runtime-capability-revalidate.ts`) reads this
* instead of the provider subscribing to `CAPABILITY_SETTLED_EVENT` itself:
* the listener is only installed by code that can *dispatch* the event, so an
* app with no capabilities never pulls the revalidation machinery — or
* `@pracht/capabilities` — into its client bundle. Keeping the set live rather
* than registering a subscriber also makes the two independent of ordering: a
* provider that mounted before the first `callCapability()` is still found.
*/
const mountedRuntimes = /* @__PURE__ */ new Set();
/** @internal Live runtime values of the currently mounted providers. */
function getMountedRuntimes() {
	return mountedRuntimes;
}
function PrachtRuntimeProvider({ children, data, params = EMPTY_ROUTE_PARAMS, routeId, routes, stateVersion = 0, url, isCurrent }) {
	registerRuntimeRoutes(routes);
	const [routeDataState, setRouteDataState] = useState(() => ({
		data,
		routeId,
		source: data,
		stateVersion,
		url
	}));
	const routeData = routeDataState.stateVersion !== stateVersion || routeDataState.routeId !== routeId ? data : routeDataState.data;
	const context = useMemo(() => ({
		data: routeData,
		params,
		routeId,
		routes,
		isCurrent,
		setData: (nextData) => setRouteDataState({
			data: nextData,
			routeId,
			source: data,
			stateVersion,
			url
		}),
		url
	}), [
		routeData,
		params,
		routeId,
		routes,
		stateVersion,
		url,
		isCurrent
	]);
	useEffect(() => {
		setRouteDataState((current) => {
			if (current.source !== data || current.stateVersion !== stateVersion || current.routeId !== routeId) return {
				data,
				routeId,
				source: data,
				stateVersion,
				url
			};
			return current.url === url ? current : {
				...current,
				url
			};
		});
	}, [
		data,
		routeId,
		stateVersion,
		url
	]);
	useEffect(() => {
		mountedRuntimes.add(context);
		return () => {
			mountedRuntimes.delete(context);
		};
	}, [context]);
	return h(RouteDataContext.Provider, {
		value: context,
		children
	});
}
function startApp(options = {}) {
	if (typeof window === "undefined") return options.initialData;
	if (typeof options.initialData !== "undefined") return options.initialData;
	return readHydrationState()?.data;
}
function readHydrationState() {
	if (typeof window === "undefined") return;
	if (window.__PRACHT_STATE__) return window.__PRACHT_STATE__;
	const element = document.getElementById(HYDRATION_STATE_ELEMENT_ID);
	if (!(element instanceof HTMLScriptElement)) return;
	const raw = element.textContent;
	if (!raw) return;
	const state = JSON.parse(raw);
	state.data = rehydrateDeferredData(state.data, state.deferred);
	window.__PRACHT_STATE__ = state;
	return state;
}
function registerRuntimeRoutes(routes) {
	if (!routes) return;
	globalThis.__PRACHT_ROUTE_DEFINITIONS__ = routes;
}
//#endregion
export { PrachtRuntimeProvider, RouteDataContext, getMountedRuntimes, readHydrationState, startApp };
