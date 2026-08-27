import { useEffect, useState } from "preact/hooks";
import { options } from "preact";
//#region src/hydration.ts
let _hydrating = false;
let _suspensionCount = 0;
let _hydrated = false;
const hydrationCompleteListeners = /* @__PURE__ */ new Set();
const oldCommit = options.__c;
options.__c = (vnode, commitQueue) => {
	let completedHydration = false;
	if (_hydrating && !_hydrated && _suspensionCount <= 0) {
		_hydrated = true;
		_hydrating = false;
		completedHydration = true;
	}
	if (oldCommit) oldCommit(vnode, commitQueue);
	if (completedHydration) queueMicrotask(notifyHydrationComplete);
};
function notifyHydrationComplete() {
	for (const listener of hydrationCompleteListeners) {
		hydrationCompleteListeners.delete(listener);
		listener();
	}
}
/**
* Mark the start of a hydration pass. Call this right before `hydrate()`.
*/
function markHydrating() {
	if (!_hydrated) _hydrating = true;
}
/**
* @internal Whether an initial hydration pass is in flight. Read by
* `hydration-suspense.ts` to decide whether a thrown promise belongs to it.
*/
function isHydrationPending() {
	return _hydrating && !_hydrated;
}
/**
* @internal Register a hydration suspension. Returns the settle callback,
* which is idempotent — a promise that both resolves and rejects, or settles
* twice, must only decrement once.
*/
function beginHydrationSuspension() {
	_suspensionCount++;
	let settled = false;
	return () => {
		if (settled) return;
		settled = true;
		_suspensionCount--;
	};
}
/**
* Returns `true` once the initial hydration (including all Suspense
* boundaries) has fully resolved. During SSR and hydration this returns
* `false`.
*/
function useIsHydrated() {
	const [hydrated, setHydrated] = useState(_hydrated);
	useEffect(() => {
		setHydrated(true);
	}, []);
	return hydrated;
}
/**
* Returns `true` only after the whole initial hydration pass, including every
* suspended boundary, has completed. Fresh client renders and island mounts
* are ready after their first commit because they do not participate in the
* full-page hydration pass.
*/
function useIsHydrationComplete() {
	const [complete, setComplete] = useState(!_hydrating || _hydrated);
	useEffect(() => {
		if (!_hydrating || _hydrated) {
			setComplete(true);
			return;
		}
		return onHydrationComplete(() => setComplete(true));
	}, []);
	return complete;
}
/** Run a callback once the complete initial hydration tree has settled. */
function onHydrationComplete(callback) {
	let active = true;
	const listener = () => {
		if (!active) return;
		active = false;
		callback();
	};
	if (_hydrated) queueMicrotask(listener);
	else hydrationCompleteListeners.add(listener);
	return () => {
		active = false;
		hydrationCompleteListeners.delete(listener);
	};
}
//#endregion
export { beginHydrationSuspension, isHydrationPending, markHydrating, onHydrationComplete, useIsHydrated, useIsHydrationComplete };
