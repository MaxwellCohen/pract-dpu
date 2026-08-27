import { deserializeRouteError, isPrachtHttpError } from "./runtime-errors.mjs";
//#region src/defer.ts
/**
* Deferred loader values — `defer()` marks a slow field, `use()` reads it.
*
* A loader returns its object as usual and wraps the values that should not
* hold up the response:
*
* ```ts
* export async function loader({ params }: LoaderArgs) {
*   const reviews = defer(getReviews(params.id));
*   return {
*     product: await getProduct(params.id), // overlaps with reviews
*     reviews,
*   };
* }
* ```
*
* The marker sits on the slow value rather than wrapping the whole return, so
* the object keeps its shape, the type records exactly which fields defer, and
* a route that calls `defer()` nowhere serializes byte-identically to before.
*
* Buffered documents and route-state responses resolve deferred values before
* writing. An SSR route with `streaming: true` instead flushes its shell and
* delivers the deferred values as they settle. The component API is identical
* on both paths: `use()` accepts a settled value, a `Deferred`, or a bare
* promise.
*
* Note that `ssg` and `isg` write files and therefore always resolve
* everything — a static file cannot stream, and shipping fallback markup as
* permanent output would be a correctness bug.
*/
const DEFERRED = Symbol.for("pracht.deferred");
/**
* Mark a loader value as deferred.
*
* Accepts a promise, or a function returning one when the work should not
* start until the value is read. Rejections surface where the value is read,
* not from the loader.
*
* A deferred value may not redirect, throw a PrachtHttpError, or set headers:
* by the time it settles the response status and headers are already decided.
* Auth checks belong in middleware or in the awaited part of the loader.
*/
function defer(source) {
	if (typeof source !== "function" && !isThenable(source)) throw new TypeError("defer() expects a promise or a function returning one. Pass the un-awaited call — defer(getReviews(id)), not defer(await getReviews(id)).");
	let started;
	if (typeof source !== "function") {
		started = Promise.resolve(source);
		started.catch(() => {});
	}
	return {
		[DEFERRED]: true,
		promise() {
			if (!started) started = (async () => source())();
			return started;
		},
		toJSON() {
			throw deferredSerializationError();
		}
	};
}
/** Whether `value` was produced by {@link defer}. */
function isDeferred(value) {
	return typeof value === "object" && value !== null && value[DEFERRED] === true;
}
function use(value) {
	if (isDeferred(value)) return readSettled(value.promise());
	if (isThenable(value)) return readSettled(value);
	return value;
}
/**
* Resolve every {@link Deferred} in a loader result.
*
* Returns the input unchanged when it holds no deferred value, so the common
* case allocates nothing. Deferred values found at any depth are awaited
* concurrently — one slow field does not serialize behind another.
*/
async function resolveDeferredData(data) {
	if (!containsDeferred(data)) return data;
	return await resolveValue(data, /* @__PURE__ */ new Map());
}
const settled = /* @__PURE__ */ new WeakMap();
/**
* Throw-until-settled, the shape Preact Suspense and
* `preact-render-to-string` both understand.
*/
function readSettled(promise) {
	let state = settled.get(promise);
	if (!state) {
		state = { status: "pending" };
		settled.set(promise, state);
		promise.then((value) => settled.set(promise, {
			status: "fulfilled",
			value
		}), (reason) => settled.set(promise, {
			status: "rejected",
			reason
		}));
	}
	if (state.status === "fulfilled") return state.value;
	if (state.status === "rejected") throw state.reason;
	throw promise;
}
function isThenable(value) {
	return typeof value === "object" && value !== null && typeof value.then === "function";
}
/**
* Whether `value` holds a `Deferred` anywhere.
*
* Walks the same shapes `resolveValue` rebuilds, so the two cannot disagree
* about what counts as traversable. Cycles are bounded by `seen`.
*/
function containsDeferred(value, seen = /* @__PURE__ */ new Set()) {
	if (isDeferred(value)) return true;
	if (typeof value !== "object" || value === null) return false;
	if (seen.has(value)) return false;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) if (isArrayIndexKey(key) && "value" in descriptor) {
			if (containsDeferred(descriptor.value, seen)) return true;
		}
		return false;
	}
	if (!isPlainObject(value)) return false;
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.enumerable && "value" in descriptor) {
		if (containsDeferred(descriptor.value, seen)) return true;
	}
	return false;
}
async function resolveValue(value, seen) {
	if (isDeferred(value)) {
		let resolved;
		try {
			resolved = await value.promise();
		} catch (error) {
			if (error instanceof Response || isPrachtHttpError(error)) throw deferredResponseError();
			throw error;
		}
		if (resolved instanceof Response) throw deferredResponseError();
		return await resolveValue(resolved, seen);
	}
	if (typeof value !== "object" || value === null) return value;
	const cached = seen.get(value);
	if (cached !== void 0) return cached;
	if (Array.isArray(value)) {
		const next = [];
		Object.setPrototypeOf(next, Object.getPrototypeOf(value));
		seen.set(value, next);
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const entries = Reflect.ownKeys(descriptors).filter((key) => key !== "length").map((key) => [key, descriptors[key]]);
		const resolved = await Promise.all(entries.map(([key, descriptor]) => isArrayIndexKey(key) && "value" in descriptor ? resolveValue(descriptor.value, seen) : void 0));
		for (let i = 0; i < entries.length; i += 1) {
			const [key, descriptor] = entries[i];
			Object.defineProperty(next, key, isArrayIndexKey(key) && "value" in descriptor ? {
				...descriptor,
				value: resolved[i]
			} : descriptor);
		}
		Object.defineProperty(next, "length", descriptors.length);
		return next;
	}
	if (!isPlainObject(value)) return value;
	const next = Object.create(Object.getPrototypeOf(value));
	seen.set(value, next);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const entries = Reflect.ownKeys(descriptors).map((key) => [key, descriptors[key]]);
	const resolved = await Promise.all(entries.map(([, descriptor]) => descriptor.enumerable && "value" in descriptor ? resolveValue(descriptor.value, seen) : void 0));
	for (let i = 0; i < entries.length; i += 1) {
		const [key, descriptor] = entries[i];
		Object.defineProperty(next, key, descriptor.enumerable && "value" in descriptor ? {
			...descriptor,
			value: resolved[i]
		} : descriptor);
	}
	return next;
}
function isPlainObject(value) {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
function isArrayIndexKey(key) {
	if (typeof key !== "string" || key === "") return false;
	const index = Number(key);
	return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}
function deferredResponseError() {
	return /* @__PURE__ */ new TypeError("A deferred loader value cannot return or throw a Response or throw a PrachtHttpError. Redirects, status, and headers must be decided before deferred work starts.");
}
function deferredSerializationError() {
	return /* @__PURE__ */ new TypeError("A deferred loader value reached serialization without being resolved. Return defer() from an enumerable data property, not from a getter.");
}
/**
* Replace every `Deferred` with `null`, collecting its promise and exact path.
* IDs include a deterministic counter plus a readable path for diagnostics;
* the counter makes them unique even when user keys render alike.
*/
function serializeDeferred(data) {
	const pending = [];
	const walk = (value, path, ancestors) => {
		if (isDeferred(value)) {
			const label = path.length === 0 ? "root" : path.map(String).join(".");
			const id = `${pending.length}:${label}`;
			pending.push({
				id,
				path: [...path],
				promise: resolveDeferredData(value)
			});
			return null;
		}
		if (typeof value !== "object" || value === null) return value;
		if (ancestors.has(value)) return value;
		ancestors.add(value);
		if (Array.isArray(value)) {
			const next = [];
			Object.setPrototypeOf(next, Object.getPrototypeOf(value));
			const descriptors = Object.getOwnPropertyDescriptors(value);
			for (const key of Reflect.ownKeys(descriptors)) {
				if (key === "length") continue;
				const descriptor = descriptors[key];
				Object.defineProperty(next, key, isArrayIndexKey(key) && "value" in descriptor ? {
					...descriptor,
					value: walk(descriptor.value, [...path, Number(key)], ancestors)
				} : descriptor);
			}
			Object.defineProperty(next, "length", descriptors.length);
			ancestors.delete(value);
			return next;
		}
		if (!isPlainObject(value)) {
			ancestors.delete(value);
			return value;
		}
		const next = Object.create(Object.getPrototypeOf(value));
		const descriptors = Object.getOwnPropertyDescriptors(value);
		for (const key of Reflect.ownKeys(descriptors)) {
			const descriptor = descriptors[key];
			Object.defineProperty(next, key, typeof key === "string" && descriptor.enumerable && "value" in descriptor ? {
				...descriptor,
				value: walk(descriptor.value, [...path, String(key)], ancestors)
			} : descriptor);
		}
		ancestors.delete(value);
		return next;
	};
	return {
		data: walk(data, [], /* @__PURE__ */ new Set()),
		pending
	};
}
/**
* The inline shim written before any deferred chunk.
*
* The streamed client runtime is an async module, so a deferred chunk can land
* before or after the real registry installs. The shim is emitted first and
* queues early `r`/`e` calls for the registry to drain.
*/
const DEFER_RUNTIME_SHIM = "window.__PRACHT_DEFER__=window.__PRACHT_DEFER__||{q:[],r:function(i,v){this.q.push([i,v,0])},e:function(i,v){this.q.push([i,v,1])}};";
const clientDeferred = /* @__PURE__ */ new Map();
function getClientEntry(id) {
	let entry = clientDeferred.get(id);
	if (!entry) {
		let resolve;
		let reject;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		promise.catch(() => {});
		entry = {
			promise,
			resolve,
			reject
		};
		clientDeferred.set(id, entry);
	}
	return entry;
}
/**
* Install the real registry and drain whatever the shim queued.
*
* Idempotent: repeated calls (client navigation, HMR) reuse the same map so a
* chunk that arrived before hydration is never lost.
*/
function installDeferRegistry() {
	if (typeof window === "undefined") return;
	const queued = window.__PRACHT_DEFER__?.q ?? [];
	const registry = {
		r(id, value) {
			getClientEntry(id).resolve(value);
		},
		e(id, error) {
			const err = isSerializedRouteError(error) ? deserializeRouteError(error) : new Error(typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error));
			getClientEntry(id).reject(err);
		}
	};
	window.__PRACHT_DEFER__ = registry;
	for (const [id, value, kind] of queued) if (kind === 1) registry.e(id, value);
	else registry.r(id, value);
}
function isSerializedRouteError(error) {
	return typeof error === "object" && error !== null && typeof error.message === "string" && typeof error.name === "string" && typeof error.status === "number";
}
/**
* Replace the out-of-band deferred locations in hydrated loader data.
*
* Returns the input by reference when there are no references, so a route that
* defers nothing pays nothing. The input comes directly from `JSON.parse`, so
* replacing its placeholder values in place cannot mutate application state.
*/
function rehydrateDeferredData(data, references = []) {
	if (references.length === 0) return data;
	installDeferRegistry();
	let result = data;
	for (const { id, path } of references) {
		const replacement = defer(() => getClientEntry(id).promise);
		if (path.length === 0) {
			result = replacement;
			continue;
		}
		let parent = result;
		for (let index = 0; index < path.length - 1; index += 1) {
			const segment = path[index];
			if (typeof parent !== "object" || parent === null || !Object.hasOwn(parent, segment)) throw new Error(`Invalid deferred hydration path for ${JSON.stringify(id)}.`);
			parent = parent[segment];
		}
		if (typeof parent !== "object" || parent === null) throw new Error(`Invalid deferred hydration path for ${JSON.stringify(id)}.`);
		defineOwnDataProperty(parent, path[path.length - 1], replacement);
	}
	return result;
}
/** Define an enumerable own property without invoking the legacy `__proto__` setter. */
function defineOwnDataProperty(target, key, value) {
	Object.defineProperty(target, key, {
		configurable: true,
		enumerable: true,
		value,
		writable: true
	});
}
//#endregion
export { DEFER_RUNTIME_SHIM, defer, rehydrateDeferredData, resolveDeferredData, serializeDeferred, use };
