import { ScriptCaptureContext } from "./script.mjs";
import { ISLAND_ELEMENT, ISLAND_EXPORT_ATTRIBUTE, ISLAND_FILE_ATTRIBUTE, ISLAND_PROPS_ATTRIBUTE, ISLAND_STRATEGIES, ISLAND_STRATEGY_ATTRIBUTE } from "./islands-shared.mjs";
import { useContext } from "preact/hooks";
import { createContext, h, options } from "preact";
//#region src/islands-server.ts
const IslandCaptureContext = createContext(null);
const islandRegistry = /* @__PURE__ */ new Map();
let islandsClientEntryUrl;
let vnodeHookInstalled = false;
let skipWrapForType = null;
const ISLAND_TYPE_PROP = "__prachtIslandType";
/**
* Register island components discovered from the islands directory. Called by
* the generated `virtual:pracht/server` module with the eager
* `import.meta.glob` result. Safe to call multiple times (dev reloads).
*/
function registerServerIslands(modules) {
	for (const [file, mod] of Object.entries(modules)) {
		if (!mod || typeof mod !== "object") continue;
		for (const [exportName, value] of Object.entries(mod)) {
			if (typeof value !== "function") continue;
			islandRegistry.set(value, {
				file,
				exportName,
				name: exportName === "default" ? islandNameFromFile(file) : exportName
			});
		}
	}
	if (islandRegistry.size > 0) installIslandVnodeHook();
}
function setIslandsClientEntryUrl(url) {
	islandsClientEntryUrl = url ?? void 0;
}
function getIslandsClientEntryUrl() {
	return islandsClientEntryUrl;
}
function islandNameFromFile(file) {
	return (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
}
function installIslandVnodeHook() {
	if (vnodeHookInstalled) return;
	vnodeHookInstalled = true;
	const previousHook = options.vnode;
	options.vnode = (vnode) => {
		const type = vnode.type;
		if (typeof type === "function" && islandRegistry.has(type)) if (skipWrapForType === type) skipWrapForType = null;
		else {
			vnode.props[ISLAND_TYPE_PROP] = type;
			vnode.type = IslandBoundary;
		}
		if (previousHook) previousHook(vnode);
	};
}
function renderOriginal(type, props) {
	skipWrapForType = type;
	try {
		return h(type, props);
	} finally {
		skipWrapForType = null;
	}
}
function IslandBoundary(props) {
	const { [ISLAND_TYPE_PROP]: type, ...rest } = props;
	const capture = useContext(IslandCaptureContext);
	const scriptCapture = useContext(ScriptCaptureContext);
	const descriptor = islandRegistry.get(type);
	if (!capture || !descriptor) {
		const { client: _client, ...componentProps } = rest;
		return renderOriginal(type, componentProps);
	}
	const { client, children, ...componentProps } = rest;
	const strategy = validateIslandStrategy(client, descriptor);
	if (children != null && !(Array.isArray(children) && children.length === 0)) throw new Error(`Island "${descriptor.name}" (${descriptor.file}) received children from a server component. Passing children/slots into islands is not supported in v1 — move the content inside the island component, or pass it as a JSON-serializable prop.`);
	validateIslandProps(componentProps, descriptor);
	capture.islands.push({
		descriptor,
		strategy
	});
	const serializedProps = JSON.stringify(componentProps);
	const attributes = {
		[ISLAND_FILE_ATTRIBUTE]: descriptor.file,
		[ISLAND_EXPORT_ATTRIBUTE]: descriptor.exportName,
		style: "display:contents"
	};
	if (strategy !== "load") attributes[ISLAND_STRATEGY_ATTRIBUTE] = strategy;
	if (serializedProps !== "{}") attributes[ISLAND_PROPS_ATTRIBUTE] = serializedProps;
	let subtree = h(IslandCaptureContext.Provider, { value: null }, renderOriginal(type, componentProps));
	if (scriptCapture) subtree = h(ScriptCaptureContext.Provider, { value: {
		...scriptCapture,
		insideIsland: true
	} }, subtree);
	return h(ISLAND_ELEMENT, attributes, subtree);
}
function validateIslandStrategy(client, descriptor) {
	if (client == null) return "load";
	if (typeof client === "string" && ISLAND_STRATEGIES.includes(client)) return client;
	throw new Error(`Island "${descriptor.name}" (${descriptor.file}) received an invalid client strategy ${JSON.stringify(client)}. Expected one of: ${ISLAND_STRATEGIES.map((s) => `"${s}"`).join(", ")}.`);
}
/**
* Validate that island props survive a JSON round trip unchanged. Throws a
* descriptive error naming the offending prop path so the failure is easy to
* fix during development.
*/
function validateIslandProps(props, descriptor) {
	for (const [key, value] of Object.entries(props)) validateIslandPropValue(value, `props.${key}`, descriptor, /* @__PURE__ */ new Set());
}
function validateIslandPropValue(value, path, descriptor, seen) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw islandPropError(path, `is ${String(value)}, which JSON cannot represent`, descriptor);
		return;
	}
	if (value === void 0) return;
	if (typeof value === "function") throw islandPropError(path, "is a function", descriptor);
	if (typeof value === "symbol") throw islandPropError(path, "is a symbol", descriptor);
	if (typeof value === "bigint") throw islandPropError(path, "is a bigint", descriptor);
	if (typeof value === "object") {
		if (seen.has(value)) throw islandPropError(path, "contains a circular reference", descriptor);
		seen.add(value);
		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				if (item === void 0) throw islandPropError(`${path}[${index}]`, "is undefined inside an array (JSON serializes it as null)", descriptor);
				validateIslandPropValue(item, `${path}[${index}]`, descriptor, seen);
			});
			seen.delete(value);
			return;
		}
		if (value.constructor === void 0) throw islandPropError(path, "is a JSX element", descriptor);
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) throw islandPropError(path, `is a ${value.constructor?.name ?? "class instance"} instance`, descriptor);
		for (const [key, entry] of Object.entries(value)) validateIslandPropValue(entry, `${path}.${key}`, descriptor, seen);
		seen.delete(value);
		return;
	}
	throw islandPropError(path, `has unsupported type "${typeof value}"`, descriptor);
}
function islandPropError(path, reason, descriptor) {
	return /* @__PURE__ */ new Error(`Island "${descriptor.name}" (${descriptor.file}) received a prop that is not JSON-serializable: ${path} ${reason}. Island props are serialized into the HTML and revived in the browser, so they must be JSON-serializable values (string, finite number, boolean, null, arrays, and plain objects).`);
}
//#endregion
export { IslandCaptureContext, getIslandsClientEntryUrl, registerServerIslands, setIslandsClientEntryUrl, validateIslandProps };
