import { useIsHydrationComplete } from "./hydration.mjs";
import { escapeScriptChildren } from "./script-escape.mjs";
import { useContext, useEffect, useRef } from "preact/hooks";
import { createContext, h } from "preact";
//#region src/script.ts
/**
* First-party `<Script>` component with loading strategies — the framework's
* next/script analogue for third-party scripts.
*
* Strategies:
* - `"beforeHydration"` — the script is collected during the server render and
*   emitted into the document `<head>` alongside `head()` scripts, so it runs
*   before the client runtime hydrates. This strategy only applies to
*   server-rendered documents: on a client-side navigation the document head
*   is not re-rendered, so the script is injected immediately instead (with a
*   dev warning).
* - `"afterHydration"` (default) — injected once the full hydration pass,
*   including suspended boundaries, has completed.
* - `"idle"` — injected in `requestIdleCallback` (setTimeout fallback).
* - `"visible"` — a zero-size placeholder is rendered in place and the script
*   is injected when the placeholder enters the viewport
*   (IntersectionObserver; immediate fallback where unsupported).
*
* A script identified by `id`, `src`, or its inline content is never injected
* twice — across re-renders, client navigations, and server-emitted
* `beforeHydration` tags already present in the document.
*
* On `hydration: "none"` routes no client JavaScript ships, so only
* `"beforeHydration"` (and `head()` scripts) can run; client strategies warn
* in dev and render nothing.
*/
const SCRIPT_STRATEGIES = [
	"beforeHydration",
	"afterHydration",
	"idle",
	"visible"
];
/** Marker attribute set on client-injected script elements. */
const SCRIPT_INJECTED_ATTRIBUTE = "data-pracht-script";
/** Marker attribute on the `strategy="visible"` placeholder element. */
const SCRIPT_PLACEHOLDER_ATTRIBUTE = "data-pracht-script-placeholder";
const ScriptCaptureContext = createContext(null);
function createScriptCapture(hydration, streaming = false, existingScripts = []) {
	return {
		scripts: [],
		keys: new Set(existingScripts.map((script) => scriptKey(script, script.children)).filter((key) => key !== null)),
		hydration,
		streaming
	};
}
/** Merge captured scripts into the document head without duplicating head() entries. */
function withCapturedScripts(head, capture) {
	if (capture.scripts.length === 0) return head;
	const headScripts = head.script ?? [];
	const headKeys = new Set(headScripts.map((script) => scriptKey(script, script.children)).filter((key) => key !== null));
	const captured = capture.scripts.filter((script) => {
		const key = scriptKey(script, script.children);
		if (key === null || headKeys.has(key)) return false;
		headKeys.add(key);
		return true;
	});
	if (captured.length === 0) return head;
	return {
		...head,
		script: [...headScripts, ...captured]
	};
}
/**
* Module-level registry of scripts already injected in this document. Keyed by
* `id`, then `src`, then inline content, so the same script is never injected
* twice across navigations or re-renders.
*/
const injectedScripts = /* @__PURE__ */ new Set();
const DEV = Boolean(import.meta.env?.DEV ?? (typeof process !== "undefined" && process.env?.NODE_ENV !== "production"));
function Script(props) {
	const capture = useContext(ScriptCaptureContext);
	const strategy = validateStrategy(props.strategy);
	const inline = normalizeInlineChildren(props.children);
	const key = scriptKey(props, inline);
	if (DEV && props.src && inline !== void 0) console.warn(`[pracht] <Script> (${describeScript(props)}) received both "src" and inline children; the inline content is ignored. Use two <Script> elements to load both.`);
	const placeholderRef = useRef(null);
	const hydrated = useIsHydrationComplete();
	if (capture === null && strategy === "beforeHydration" && key !== null && !injectedScripts.has(key) && existsInDocument(props, inline)) injectedScripts.add(key);
	useEffect(() => {
		if (!hydrated || key === null) return;
		if (injectedScripts.has(key)) return;
		if (existsInDocument(props, inline)) {
			injectedScripts.add(key);
			return;
		}
		let cancelled = false;
		const inject = () => {
			if (cancelled || injectedScripts.has(key)) return;
			injectedScripts.add(key);
			injectScriptElement(props, inline);
		};
		if (strategy === "beforeHydration") {
			if (DEV) console.warn(`[pracht] <Script strategy="beforeHydration"> (${describeScript(props)}) mounted in the browser without a matching server-emitted tag. beforeHydration only applies to server-rendered documents; on client-side navigations the script is injected immediately instead.`);
			inject();
			return;
		}
		if (strategy === "afterHydration") {
			inject();
			return;
		}
		if (strategy === "idle") {
			const cancel = scheduleWhenIdle(inject);
			return () => {
				cancelled = true;
				cancel();
			};
		}
		const cancel = scheduleWhenVisible(placeholderRef.current, inject);
		return () => {
			cancelled = true;
			cancel();
		};
	}, [
		hydrated,
		key,
		strategy
	]);
	if (key === null) {
		if (DEV) console.warn("[pracht] <Script> requires either a \"src\" prop or inline string children.");
		return null;
	}
	if (capture) {
		if (strategy === "beforeHydration") {
			if (capture.streaming) {
				if (capture.keys.has(key)) return null;
				capture.keys.add(key);
				return renderInlineScriptTag(props, inline);
			}
			if (!capture.keys.has(key)) {
				capture.keys.add(key);
				capture.scripts.push(toHeadScriptDescriptor(props, inline));
			}
		} else if (DEV && capture.hydration === "none") console.warn(`[pracht] <Script strategy="${strategy}"> (${describeScript(props)}) rendered on a hydration: "none" route. These routes ship no client JavaScript, so client strategies can never run — use strategy: "beforeHydration" or a head() script entry instead.`);
		else if (DEV && capture.hydration === "islands" && !capture.insideIsland) console.warn(`[pracht] <Script strategy="${strategy}"> (${describeScript(props)}) rendered outside any island on a hydration: "islands" route. Only islands hydrate on these routes, so this script can never run — move it inside an island, or use strategy: "beforeHydration".`);
		return strategy === "visible" ? renderPlaceholder(key, placeholderRef) : null;
	}
	if (typeof document === "undefined" && strategy === "beforeHydration") return renderInlineScriptTag(props, inline);
	return strategy === "visible" ? renderPlaceholder(key, placeholderRef) : null;
}
function renderPlaceholder(key, ref) {
	return h("span", {
		[SCRIPT_PLACEHOLDER_ATTRIBUTE]: key,
		style: "position:absolute;width:0;height:0;overflow:hidden",
		ref
	});
}
function validateStrategy(strategy) {
	if (strategy == null) return "afterHydration";
	if (SCRIPT_STRATEGIES.includes(strategy)) return strategy;
	throw new Error(`<Script> received an invalid strategy ${JSON.stringify(strategy)}. Expected one of: ` + SCRIPT_STRATEGIES.map((s) => `"${s}"`).join(", ") + ".");
}
function normalizeInlineChildren(children) {
	if (children == null) return void 0;
	const parts = Array.isArray(children) ? children : [children];
	if (parts.length === 0) return void 0;
	for (const part of parts) if (typeof part !== "string") throw new Error("<Script> inline children must be a string of script source. JSX children are not supported — pass the code as a template literal string.");
	return parts.join("");
}
function scriptKey(props, inline) {
	if (props.id) return `id:${props.id}`;
	if (props.src) return `src:${props.src}`;
	if (inline !== void 0) return `inline:${inline}`;
	return null;
}
function describeScript(props) {
	return props.id ?? props.src ?? "inline";
}
/**
* Allowlisted attribute record. Unknown props — including any `on*` handler —
* never pass through, matching the head-rendering safety posture in
* runtime-html.ts.
*/
function toAttributeRecord(props) {
	const out = {};
	if (props.src) out.src = props.src;
	if (props.id) out.id = props.id;
	if (props.async) out.async = "";
	if (props.defer) out.defer = "";
	if (props.type) out.type = props.type;
	if (props.nonce) out.nonce = props.nonce;
	if (props.integrity) out.integrity = props.integrity;
	if (props.crossorigin) out.crossorigin = props.crossorigin;
	if (props.referrerpolicy) out.referrerpolicy = props.referrerpolicy;
	return out;
}
function toHeadScriptDescriptor(props, inline) {
	const descriptor = toAttributeRecord(props);
	if (!props.src && inline !== void 0) descriptor.children = inline;
	return descriptor;
}
function renderInlineScriptTag(props, inline) {
	const attributes = toAttributeRecord(props);
	if (!props.src && inline !== void 0) attributes.dangerouslySetInnerHTML = { __html: escapeScriptChildren(inline, props.type) };
	return h("script", attributes);
}
function existsInDocument(props, inline) {
	if (typeof document === "undefined") return false;
	if (props.id) {
		const el = document.getElementById(props.id);
		if (el != null) return el.tagName === "SCRIPT";
	}
	const scripts = document.querySelectorAll("script");
	if (props.src) {
		for (const el of scripts) if (el.getAttribute("src") === props.src) return true;
		return false;
	}
	if (inline !== void 0) {
		const escaped = escapeScriptChildren(inline, props.type);
		for (const el of scripts) if (el.textContent === inline || el.textContent === escaped) return true;
	}
	return false;
}
function injectScriptElement(props, inline) {
	const element = document.createElement("script");
	for (const [name, value] of Object.entries(toAttributeRecord(props))) element.setAttribute(name, value);
	element.setAttribute(SCRIPT_INJECTED_ATTRIBUTE, "");
	if (props.src) {
		if (props.onLoad) element.addEventListener("load", props.onLoad);
		if (props.onError) element.addEventListener("error", props.onError);
	} else if (inline !== void 0) element.textContent = inline;
	document.head.appendChild(element);
}
function scheduleWhenIdle(task) {
	if (typeof requestIdleCallback === "function") {
		const handle = requestIdleCallback(() => task());
		return () => {
			if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
		};
	}
	const handle = setTimeout(task, 200);
	return () => clearTimeout(handle);
}
function scheduleWhenVisible(target, task) {
	if (typeof IntersectionObserver === "undefined" || target == null) {
		task();
		return () => {};
	}
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			observer.disconnect();
			task();
			return;
		}
	});
	observer.observe(target);
	return () => observer.disconnect();
}
//#endregion
export { Script, ScriptCaptureContext, createScriptCapture, withCapturedScripts };
