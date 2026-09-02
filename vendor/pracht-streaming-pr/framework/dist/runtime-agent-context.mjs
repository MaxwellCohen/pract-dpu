//#region src/runtime-agent-context.ts
const agentIdentitySnapshots = /* @__PURE__ */ new WeakSet();
const boundAgentContexts = /* @__PURE__ */ new WeakMap();
const boundMcpTokenContexts = /* @__PURE__ */ new WeakMap();
/**
* Bind framework-verified agent identity onto an application request context.
* The framework-owned field and its value are immutable snapshots, so
* application middleware cannot rewrite the identity used by later policy or
* audit checks. Frozen and sealed ordinary contexts get an extensible overlay
* so the binding does not turn a valid request into a runtime exception while
* class instances keep their private-field receivers and arrays keep their
* brand. Native built-ins that require internal slots cannot be represented by
* an overlay and fail closed with guidance to wrap them in a mutable context.
* Writes to existing application fields keep using the original receiver;
* fields added by middleware live on the overlay.
*/
function bindAgentContext(supplied, agent) {
	const context = supplied ?? {};
	const boundAgent = snapshotAgentIdentity(agent);
	if (typeof context === "object" && context !== null || typeof context === "function") {
		if (boundAgentContexts.has(context)) {
			const previous = boundAgentContexts.get(context);
			if (sameAgentIdentity(previous.agent, boundAgent)) return previous.context;
			throw new TypeError("Pracht request contexts cannot be reused across different verified agent identities. Create a fresh context for each request.");
		}
		try {
			Object.defineProperty(context, "agent", {
				configurable: false,
				enumerable: true,
				value: boundAgent,
				writable: false
			});
			boundAgentContexts.set(context, {
				agent: boundAgent,
				context
			});
			return context;
		} catch {}
		const descriptor = Reflect.getOwnPropertyDescriptor(context, "agent");
		if (descriptor && descriptor.configurable === false && "value" in descriptor && descriptor.writable === false && (descriptor.value === null && boundAgent === null || isAgentIdentitySnapshot(descriptor.value) && isAgentIdentitySnapshot(boundAgent) && sameAgentIdentity(descriptor.value, boundAgent))) {
			boundAgentContexts.set(context, {
				agent: boundAgent,
				context
			});
			return context;
		}
		if (descriptor && (!("value" in descriptor) || descriptor.value !== null)) throw new TypeError("Pracht cannot safely replace an immutable application-owned agent field on the supplied request context. Create a fresh context without an application-owned agent field.");
		if (!descriptor && Reflect.has(context, "agent")) throw new TypeError("Pracht cannot safely replace an inherited application-owned agent field on the supplied request context. Create a fresh context without an application-owned agent field.");
		assertOverlayableContext(context);
		const overlay = immutableFrameworkContext(context, { agent: boundAgent });
		const binding = {
			agent: boundAgent,
			context: overlay
		};
		boundAgentContexts.set(context, binding);
		boundAgentContexts.set(overlay, binding);
		return overlay;
	}
	return Object.freeze({ agent: boundAgent });
}
const requestContextOverlays = /* @__PURE__ */ new WeakSet();
/**
* Create a fresh request-local view over an adapter-supplied context.
*
* Reads and receiver-sensitive methods still reach the supplied object, while
* framework-owned fields and otherwise-new writes stay on this request's
* overlay. This lets adapters reuse a base context without carrying identity
* from one request into the next.
*/
function isolateRequestContext(context) {
	if ((typeof context !== "object" || context === null) && typeof context !== "function") return context;
	return isolateRequestContextWithFields(context, {});
}
function isolateRequestContextWithFields(context, frameworkFields, allowShadowedFrameworkFields = false) {
	assertOverlayableContext(context);
	const overlay = immutableFrameworkContext(context, frameworkFields, allowShadowedFrameworkFields);
	requestContextOverlays.add(overlay);
	return overlay;
}
/** @internal Whether this context is already a request-local overlay. */
function isRequestContextOverlay(context) {
	return (typeof context === "object" && context !== null || typeof context === "function") && requestContextOverlays.has(context);
}
/**
* Bind a framework-verified OAuth principal onto a request-local context.
* Rebinding the same framework-owned overlay is idempotent so an MCP tool can
* pass its context to a nested capability. Any application-owned or inherited
* `tokenAuth` field still fails closed.
*/
function bindMcpTokenContext(context, principal) {
	if ((typeof context !== "object" || context === null) && typeof context !== "function") return Object.freeze({ tokenAuth: principal });
	const previous = boundMcpTokenContexts.get(context);
	if (previous) {
		if (previous.principal === principal) return previous.context;
		throw new TypeError("Pracht request contexts cannot be reused across different verified OAuth principals. Create a fresh context for each request.");
	}
	const requestContext = isRequestContextOverlay(context) ? context : isolateRequestContext(context);
	const target = requestContext;
	if (Reflect.getOwnPropertyDescriptor(target, "tokenAuth") || Reflect.has(target, "tokenAuth")) throw new TypeError("Pracht cannot replace an application-owned `tokenAuth` field on the supplied request context. The field is reserved for the framework — rename yours.");
	try {
		Object.defineProperty(target, "tokenAuth", {
			configurable: false,
			enumerable: true,
			value: principal,
			writable: false
		});
	} catch {
		throw new TypeError("Pracht could not bind the verified token principal to a frozen or sealed request context. Create a fresh mutable request context for each request.");
	}
	const binding = {
		principal,
		context: target
	};
	boundMcpTokenContexts.set(target, binding);
	return requestContext;
}
/** @internal Reassert the transport principal over nested caller-supplied context. */
function rebindMcpTokenContext(context, principal) {
	if ((typeof context !== "object" || context === null) && typeof context !== "function") return Object.freeze({ tokenAuth: principal });
	const previous = boundMcpTokenContexts.get(context);
	if (previous?.principal === principal) return previous.context;
	const requestContext = isolateRequestContextWithFields(context, { tokenAuth: principal }, true);
	const binding = {
		principal,
		context: requestContext
	};
	boundMcpTokenContexts.set(requestContext, binding);
	return requestContext;
}
/**
* Add framework-owned fields without manufacturing a fake class instance.
* Copying descriptors onto `Object.create(instancePrototype)` loses private
* fields. This overlay keeps application writes local while forwarding reads
* to the original receiver; prototype methods are bound for the same reason.
*/
function immutableFrameworkContext(context, frameworkFields, allowShadowedFrameworkFields = false) {
	const prototype = Object.getPrototypeOf(context);
	const materializedContextKeys = /* @__PURE__ */ new Set();
	const isArrayContext = Array.isArray(context);
	const target = typeof context === "function" ? isConstructableContext(context) ? function(...args) {
		return Reflect.apply(context, this, args);
	}.bind(void 0) : (...args) => Reflect.apply(context, void 0, args) : isArrayContext ? [] : Object.create(prototype);
	if (typeof context === "function") for (const property of [
		"name",
		"length",
		"prototype"
	]) {
		const descriptor = Reflect.getOwnPropertyDescriptor(context, property);
		if (descriptor && Reflect.defineProperty(target, property, descriptor)) materializedContextKeys.add(property);
	}
	else if (isArrayContext) {
		const descriptor = Reflect.getOwnPropertyDescriptor(context, "length");
		if (descriptor && Reflect.defineProperty(target, "length", descriptor)) materializedContextKeys.add("length");
	}
	Object.setPrototypeOf(target, prototype);
	const reservedFields = new Set(Reflect.ownKeys(frameworkFields));
	for (const property of reservedFields) Object.defineProperty(target, property, {
		configurable: false,
		enumerable: true,
		value: frameworkFields[property],
		writable: false
	});
	const boundMethods = /* @__PURE__ */ new WeakMap();
	const contextBoundMethods = /* @__PURE__ */ new WeakSet();
	const boundAccessors = /* @__PURE__ */ new WeakMap();
	const contextBoundAccessors = /* @__PURE__ */ new WeakSet();
	const bindContextMethod = (method) => {
		if (contextBoundMethods.has(method)) return method;
		let bound = boundMethods.get(method);
		if (!bound) {
			let guarded;
			guarded = new Proxy(method, {
				apply(target, _thisArg, args) {
					assertNoInheritedFrameworkField();
					return Reflect.apply(target, context, args);
				},
				construct(_target, args, newTarget) {
					assertNoInheritedFrameworkField();
					return Reflect.construct(method, args, newTarget === guarded ? method : newTarget);
				}
			});
			bound = guarded;
			boundMethods.set(method, bound);
			contextBoundMethods.add(bound);
		}
		return bound;
	};
	const bindContextAccessor = (accessor) => {
		if (contextBoundAccessors.has(accessor)) return accessor;
		let bound = boundAccessors.get(accessor);
		if (!bound) {
			const receiverBound = accessor.bind(context);
			bound = (...args) => {
				assertNoInheritedFrameworkField();
				return Reflect.apply(receiverBound, void 0, args);
			};
			boundAccessors.set(accessor, bound);
			contextBoundAccessors.add(bound);
		}
		return bound;
	};
	const targetContextDescriptor = (property, descriptor) => {
		if ("value" in descriptor && typeof descriptor.value === "function" && property !== "constructor") return {
			...descriptor,
			value: bindContextMethod(descriptor.value)
		};
		const targetDescriptor = { ...descriptor };
		if (typeof descriptor.get === "function") targetDescriptor.get = bindContextAccessor(descriptor.get);
		if (typeof descriptor.set === "function") targetDescriptor.set = bindContextAccessor(descriptor.set);
		return targetDescriptor;
	};
	const locksRawContextMethod = (property, currentDescriptor, descriptor) => {
		const resultingValue = Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : "value" in currentDescriptor ? currentDescriptor.value : void 0;
		const resultingConfigurable = descriptor.configurable ?? currentDescriptor.configurable;
		const resultingWritable = descriptor.writable ?? ("writable" in currentDescriptor && currentDescriptor.writable);
		return property !== "constructor" && Object.prototype.hasOwnProperty.call(descriptor, "value") && typeof resultingValue === "function" && resultingConfigurable === false && resultingWritable === false && !contextBoundMethods.has(resultingValue);
	};
	const isCompatibleBoundMethodDefinition = (property, currentDescriptor, descriptor) => property !== "constructor" && "value" in currentDescriptor && typeof currentDescriptor.value === "function" && Object.prototype.hasOwnProperty.call(descriptor, "value") && descriptor.value === bindContextMethod(currentDescriptor.value) && (descriptor.enumerable === void 0 || descriptor.enumerable === currentDescriptor.enumerable) && !(descriptor.writable === true && currentDescriptor.writable === false);
	const isCompatibleBoundAccessorDefinition = (currentDescriptor, descriptor) => {
		if ("value" in currentDescriptor || Object.prototype.hasOwnProperty.call(descriptor, "value") || Object.prototype.hasOwnProperty.call(descriptor, "writable")) return false;
		if (descriptor.enumerable !== void 0 && descriptor.enumerable !== currentDescriptor.enumerable) return false;
		if (descriptor.configurable === true && currentDescriptor.configurable === false) return false;
		for (const property of ["get", "set"]) {
			if (!Object.prototype.hasOwnProperty.call(descriptor, property)) continue;
			const currentAccessor = currentDescriptor[property];
			const expected = typeof currentAccessor === "function" ? bindContextAccessor(currentAccessor) : currentAccessor;
			if (descriptor[property] !== expected) return false;
		}
		return true;
	};
	const synchronizeMaterializedContextDescriptor = (property) => {
		if (!materializedContextKeys.has(property)) return;
		const contextDescriptor = Reflect.getOwnPropertyDescriptor(context, property);
		if (!contextDescriptor) {
			if (Reflect.deleteProperty(target, property)) materializedContextKeys.delete(property);
			return;
		}
		Reflect.defineProperty(target, property, targetContextDescriptor(property, contextDescriptor));
	};
	const synchronizeContextPrototype = () => {
		const contextPrototype = Reflect.getPrototypeOf(context);
		return Reflect.getPrototypeOf(target) === contextPrototype || Reflect.setPrototypeOf(target, contextPrototype);
	};
	function assertNoInheritedFrameworkField() {
		if (allowShadowedFrameworkFields) return;
		for (const property of reservedFields) if (!Object.prototype.hasOwnProperty.call(context, property) && Reflect.has(context, property)) throw new TypeError(`Pracht detected an inherited application-owned ${String(property)} field after binding the request context. The ${String(property)} field is reserved for the framework.`);
	}
	let proxy;
	proxy = new Proxy(target, {
		apply(_target, thisArg, args) {
			return Reflect.apply(context, thisArg, args);
		},
		construct(_target, args, newTarget) {
			return Reflect.construct(context, args, newTarget === proxy ? context : newTarget);
		},
		setPrototypeOf(target, newPrototype) {
			if (!Reflect.setPrototypeOf(context, newPrototype)) return false;
			return Reflect.setPrototypeOf(target, newPrototype);
		},
		getPrototypeOf(target) {
			synchronizeContextPrototype();
			return Reflect.getPrototypeOf(target);
		},
		get(target, property, receiver) {
			if (Object.prototype.hasOwnProperty.call(target, property) && !materializedContextKeys.has(property)) return Reflect.get(target, property, receiver);
			if (!reservedFields.has(property)) assertNoInheritedFrameworkField();
			const value = Reflect.get(context, property, context);
			if (typeof value !== "function" || property === "constructor") return value;
			const targetDescriptor = materializedContextKeys.has(property) ? Reflect.getOwnPropertyDescriptor(target, property) : void 0;
			if (targetDescriptor && "value" in targetDescriptor && targetDescriptor.configurable === false && targetDescriptor.writable === false) return targetDescriptor.value;
			return bindContextMethod(value);
		},
		set(target, property, value) {
			if (materializedContextKeys.has(property)) {
				if (!Reflect.set(context, property, value, context)) return false;
				const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
				if (descriptor && "value" in descriptor) {
					const contextDescriptor = Reflect.getOwnPropertyDescriptor(context, property);
					return !!contextDescriptor && Reflect.defineProperty(target, property, targetContextDescriptor(property, contextDescriptor));
				}
				return true;
			}
			if (Object.prototype.hasOwnProperty.call(target, property)) return Reflect.set(target, property, value, target);
			if (Object.prototype.hasOwnProperty.call(context, property) || hasPrototypeSetter(context, property)) return Reflect.set(context, property, value, context);
			return Reflect.set(target, property, value, target);
		},
		defineProperty(target, property, descriptor) {
			if (materializedContextKeys.has(property)) {
				const currentDescriptor = Reflect.getOwnPropertyDescriptor(context, property);
				if (!currentDescriptor || locksRawContextMethod(property, currentDescriptor, descriptor)) return false;
				if (!Reflect.defineProperty(context, property, descriptor)) return (isCompatibleBoundMethodDefinition(property, currentDescriptor, descriptor) || isCompatibleBoundAccessorDefinition(currentDescriptor, descriptor)) && Reflect.defineProperty(target, property, descriptor);
				const contextDescriptor = Reflect.getOwnPropertyDescriptor(context, property);
				return !!contextDescriptor && Reflect.defineProperty(target, property, targetContextDescriptor(property, contextDescriptor));
			}
			if (Object.prototype.hasOwnProperty.call(target, property)) return Reflect.defineProperty(target, property, descriptor);
			if (Object.prototype.hasOwnProperty.call(context, property)) {
				const currentDescriptor = Reflect.getOwnPropertyDescriptor(context, property);
				if (!currentDescriptor || locksRawContextMethod(property, currentDescriptor, descriptor)) return false;
				if (!Reflect.defineProperty(context, property, descriptor)) {
					if (!isCompatibleBoundMethodDefinition(property, currentDescriptor, descriptor) && !isCompatibleBoundAccessorDefinition(currentDescriptor, descriptor) || !Reflect.defineProperty(target, property, descriptor)) return false;
					materializedContextKeys.add(property);
					return true;
				}
				const contextDescriptor = Reflect.getOwnPropertyDescriptor(context, property);
				if (!contextDescriptor) return false;
				const materializedDescriptor = Object.prototype.hasOwnProperty.call(descriptor, "value") ? contextDescriptor : targetContextDescriptor(property, contextDescriptor);
				if (!Reflect.defineProperty(target, property, materializedDescriptor)) return false;
				materializedContextKeys.add(property);
				return true;
			}
			return Reflect.defineProperty(target, property, descriptor);
		},
		deleteProperty(target, property) {
			if (materializedContextKeys.has(property)) {
				if (!Reflect.deleteProperty(context, property)) return false;
				materializedContextKeys.delete(property);
				return Reflect.deleteProperty(target, property);
			}
			if (Object.prototype.hasOwnProperty.call(target, property)) return Reflect.deleteProperty(target, property);
			if (Object.prototype.hasOwnProperty.call(context, property)) return Reflect.deleteProperty(context, property);
			return true;
		},
		getOwnPropertyDescriptor(target, property) {
			synchronizeMaterializedContextDescriptor(property);
			const ownDescriptor = Reflect.getOwnPropertyDescriptor(target, property);
			if (ownDescriptor) return ownDescriptor;
			const descriptor = Reflect.getOwnPropertyDescriptor(context, property);
			if (!descriptor) return void 0;
			if (descriptor.configurable === false) {
				if (!Reflect.defineProperty(target, property, targetContextDescriptor(property, descriptor))) return;
				materializedContextKeys.add(property);
				return Reflect.getOwnPropertyDescriptor(target, property);
			}
			return {
				...targetContextDescriptor(property, descriptor),
				configurable: true
			};
		},
		has(target, property) {
			synchronizeMaterializedContextDescriptor(property);
			return Reflect.has(target, property) || Reflect.has(context, property);
		},
		ownKeys(target) {
			for (const property of materializedContextKeys) synchronizeMaterializedContextDescriptor(property);
			return [...new Set([...Reflect.ownKeys(context), ...Reflect.ownKeys(target)])];
		},
		preventExtensions(target) {
			if (!synchronizeContextPrototype()) return false;
			for (const property of Reflect.ownKeys(context)) {
				if (Object.prototype.hasOwnProperty.call(target, property)) continue;
				const descriptor = Reflect.getOwnPropertyDescriptor(context, property);
				if (!descriptor || !Reflect.defineProperty(target, property, targetContextDescriptor(property, descriptor))) return false;
				materializedContextKeys.add(property);
			}
			if (!Reflect.preventExtensions(context)) return false;
			return Reflect.preventExtensions(target);
		}
	});
	return proxy;
}
function snapshotAgentIdentity(agent) {
	if (!agent) return null;
	if (isAgentIdentitySnapshot(agent)) return agent;
	const { verified, agentDomain, keyId } = agent;
	if (verified !== true || typeof keyId !== "string" || agentDomain !== null && typeof agentDomain !== "string") return null;
	const snapshot = Object.freeze({
		verified: true,
		agentDomain,
		keyId
	});
	agentIdentitySnapshots.add(snapshot);
	return snapshot;
}
function isAgentIdentitySnapshot(value) {
	return typeof value === "object" && value !== null && agentIdentitySnapshots.has(value);
}
function sameAgentIdentity(left, right) {
	if (left === right) return true;
	if (!left || typeof left !== "object" || !right) return false;
	const candidate = left;
	return candidate.verified === true && candidate.agentDomain === right.agentDomain && candidate.keyId === right.keyId;
}
function isConstructableContext(context) {
	try {
		Reflect.construct(Object, [], context);
		return true;
	} catch {
		return false;
	}
}
function assertOverlayableContext(context) {
	if (typeof context === "function" || Array.isArray(context)) return;
	const nativeContext = nativeInternalSlotContext(context);
	if (!nativeContext) return;
	throw new TypeError(`Pracht cannot safely create a request-local overlay for an [object ${nativeContext}] request context because an overlay cannot preserve its native internal slots. Wrap the value in a fresh mutable request context object.`);
}
function nativeInternalSlotContext(context) {
	let prototype = Reflect.getPrototypeOf(context);
	while (prototype !== null) {
		const parent = Reflect.getPrototypeOf(prototype);
		const descriptor = Reflect.getOwnPropertyDescriptor(prototype, "constructor");
		const constructor = descriptor && "value" in descriptor ? descriptor.value : void 0;
		if (typeof constructor === "function") {
			const name = nativeConstructorName(prototype, constructor);
			if (parent === null && name === "Object") return null;
			if (isNativeConstructor(constructor) || isRealmGlobalTaggedPrototype(prototype, constructor)) return name ?? "native";
		}
		prototype = parent;
	}
	return null;
}
function nativeConstructorName(prototype, constructor) {
	const tag = Reflect.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
	if (tag && "value" in tag && typeof tag.value === "string") return tag.value;
	const name = Reflect.getOwnPropertyDescriptor(constructor, "name");
	return name && "value" in name && typeof name.value === "string" ? name.value : null;
}
function isNativeConstructor(constructor) {
	try {
		return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(constructor));
	} catch {
		return false;
	}
}
function isRealmGlobalTaggedPrototype(prototype, constructor) {
	const tag = Reflect.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
	if (!tag || !("value" in tag) || typeof tag.value !== "string") return false;
	const globalDescriptor = Reflect.getOwnPropertyDescriptor(globalThis, tag.value);
	return !!globalDescriptor && "value" in globalDescriptor && globalDescriptor.value === constructor;
}
/** Prototype accessors must keep the original class instance as `this`. */
function hasPrototypeSetter(context, property) {
	let prototype = Object.getPrototypeOf(context);
	while (prototype !== null) {
		const descriptor = Reflect.getOwnPropertyDescriptor(prototype, property);
		if (descriptor) return typeof descriptor.set === "function";
		prototype = Object.getPrototypeOf(prototype);
	}
	return false;
}
//#endregion
export { bindAgentContext, bindMcpTokenContext, rebindMcpTokenContext, snapshotAgentIdentity };
