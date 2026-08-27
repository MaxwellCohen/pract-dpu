//#region src/navigation-state.ts
const IDLE_NAVIGATION = { state: "idle" };
let currentNavigation = IDLE_NAVIGATION;
let navigationToken = 0;
const listeners = /* @__PURE__ */ new Set();
function getNavigation() {
	return currentNavigation;
}
function subscribeToNavigation(listener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
function emit() {
	const snapshot = Array.from(listeners);
	for (const listener of snapshot) listener(currentNavigation);
}
/**
* Mark a navigation as in-flight. Returns a token that must be passed to
* `settleNavigation()` — settling is a no-op when a newer navigation or
* submission has started in the meantime, so superseded navigations never
* stomp the state of the one that replaced them.
*/
function beginLoadingNavigation(location) {
	currentNavigation = {
		state: "loading",
		location
	};
	emit();
	return ++navigationToken;
}
function beginSubmittingNavigation(location, formData) {
	currentNavigation = {
		state: "submitting",
		location,
		formData
	};
	emit();
	return ++navigationToken;
}
function settleNavigation(token) {
	if (token !== navigationToken) return;
	if (currentNavigation.state === "idle") return;
	currentNavigation = IDLE_NAVIGATION;
	emit();
}
/**
* Parse a navigation target (relative or absolute) into the location shape
* exposed through `useNavigation()`.
*/
function createNavigationLocation(url) {
	const base = typeof window !== "undefined" ? window.location.href : "http://pracht.local";
	let parsed;
	try {
		parsed = new URL(url, base);
	} catch {
		return {
			hash: "",
			href: url,
			pathname: url,
			search: ""
		};
	}
	return {
		hash: parsed.hash,
		href: parsed.pathname + parsed.search + parsed.hash,
		pathname: parsed.pathname,
		search: parsed.search
	};
}
//#endregion
export { beginLoadingNavigation, beginSubmittingNavigation, createNavigationLocation, getNavigation, settleNavigation, subscribeToNavigation };
