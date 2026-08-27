//#region src/prefetch-cache.ts
const CACHE_TTL_MS = 3e4;
const MAX_PREFETCH_CACHE_ENTRIES = 100;
const EMPTY_ROUTE_STATE = {
	type: "data",
	data: void 0
};
const prefetchCache = /* @__PURE__ */ new Map();
const EMPTY_ROUTE_STATE_PROMISE = Promise.resolve(EMPTY_ROUTE_STATE);
function clearPrefetchCache() {
	prefetchCache.clear();
}
function getCachedRouteState(url) {
	const entry = prefetchCache.get(url);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
		prefetchCache.delete(url);
		return null;
	}
	prefetchCache.delete(url);
	prefetchCache.set(url, entry);
	return entry.promise;
}
function cacheRouteState(url, promise) {
	sweepPrefetchCache();
	prefetchCache.set(url, {
		promise,
		timestamp: Date.now()
	});
	trimMapToSize(prefetchCache, MAX_PREFETCH_CACHE_ENTRIES);
}
/**
* Remove a cached entry, but only when it still holds `promise` — a newer
* entry cached under the same URL must not be evicted by an older rejection.
*/
function removeCachedRouteState(url, promise) {
	const entry = prefetchCache.get(url);
	if (entry && entry.promise === promise) prefetchCache.delete(url);
}
function sweepPrefetchCache(now = Date.now()) {
	for (const [url, entry] of prefetchCache) if (now - entry.timestamp > CACHE_TTL_MS) prefetchCache.delete(url);
}
function trimMapToSize(map, maxEntries) {
	while (map.size > maxEntries) {
		const first = map.keys().next();
		if (first.done) return;
		map.delete(first.value);
	}
}
//#endregion
export { EMPTY_ROUTE_STATE_PROMISE, cacheRouteState, clearPrefetchCache, getCachedRouteState, removeCachedRouteState, trimMapToSize };
