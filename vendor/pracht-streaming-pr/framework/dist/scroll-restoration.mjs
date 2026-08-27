//#region src/scroll-restoration.ts
const STORAGE_KEY = "pracht:scroll-positions";
const MAX_SCROLL_ENTRIES = 50;
const HISTORY_STATE_KEY = "__prachtScrollKey";
function readEntries(storage) {
	if (!storage) return [];
	let raw = null;
	try {
		raw = storage.getItem(STORAGE_KEY);
	} catch {
		return [];
	}
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number" && typeof entry[2] === "number");
	} catch {
		return [];
	}
}
/**
* Create a scroll position store backed by the given storage (normally
* `sessionStorage`). Storage failures (private mode, quota) degrade to an
* in-memory map for the current page lifetime.
*/
function createScrollPositionStore(storage, maxEntries = MAX_SCROLL_ENTRIES) {
	const positions = /* @__PURE__ */ new Map();
	for (const [key, x, y] of readEntries(storage)) positions.set(key, {
		x,
		y
	});
	function persist() {
		if (!storage) return;
		const entries = [];
		for (const [key, position] of positions) entries.push([
			key,
			position.x,
			position.y
		]);
		try {
			storage.setItem(STORAGE_KEY, JSON.stringify(entries));
		} catch {}
	}
	return {
		get(key) {
			return positions.get(key) ?? null;
		},
		set(key, position) {
			positions.delete(key);
			positions.set(key, position);
			while (positions.size > maxEntries) {
				const oldest = positions.keys().next();
				if (oldest.done) break;
				positions.delete(oldest.value);
			}
			persist();
		}
	};
}
function getSessionScrollStorage() {
	if (typeof window === "undefined") return null;
	try {
		return window.sessionStorage ?? null;
	} catch {
		return null;
	}
}
function generateScrollKey() {
	return Math.random().toString(36).slice(2, 10);
}
/** Read the pracht scroll key from a `history.state` value, if present. */
function readScrollKeyFromHistoryState(state) {
	if (!state || typeof state !== "object") return null;
	const key = state[HISTORY_STATE_KEY];
	return typeof key === "string" ? key : null;
}
/** Merge the pracht scroll key into an existing `history.state` value. */
function withScrollKeyInHistoryState(state, key) {
	if (state && typeof state === "object" && !Array.isArray(state)) return {
		...state,
		[HISTORY_STATE_KEY]: key
	};
	return { [HISTORY_STATE_KEY]: key };
}
//#endregion
export { createScrollPositionStore, generateScrollKey, getSessionScrollStorage, readScrollKeyFromHistoryState, withScrollKeyInHistoryState };
