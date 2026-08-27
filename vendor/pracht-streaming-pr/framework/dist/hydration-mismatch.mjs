import { installHydrationSuspenseTracking } from "./hydration-suspense.mjs";
import { options } from "preact";
//#region src/hydration-mismatch.ts
const HYDRATION_BANNER_ID = "__pracht_hydration_mismatch__";
const MODE_HYDRATE = 32;
let installed = false;
let prevMismatch;
let prevCatchError;
let prevCommit;
const pendingSuspenseChecks = /* @__PURE__ */ new Set();
let flushScheduled = false;
function installHydrationMismatchWarning() {
	if (installed) return;
	installed = true;
	installHydrationSuspenseTracking();
	const opts = options;
	prevMismatch = opts.__m;
	prevCatchError = opts.__e;
	prevCommit = opts.__c;
	opts.__m = function(vnode) {
		appendHydrationWarning(vnode);
		if (prevMismatch) prevMismatch(vnode);
	};
	opts.__e = function(err, newVNode, oldVNode, errorInfo) {
		trackSuspendingVNode(err, newVNode);
		if (prevCatchError) prevCatchError(err, newVNode, oldVNode, errorInfo);
	};
	opts.__c = function(vnode, commitQueue) {
		if (prevCommit) prevCommit(vnode, commitQueue);
		scheduleSuspenseCheckFlush();
	};
}
function trackSuspendingVNode(err, vnode) {
	if (!vnode) return;
	if (!err || typeof err.then !== "function") return;
	if (!!!(vnode.__u && vnode.__u & MODE_HYDRATE || vnode.__h)) return;
	const promise = err;
	const onSettle = () => {
		pendingSuspenseChecks.add(vnode);
	};
	promise.then(onSettle, onSettle);
}
function scheduleSuspenseCheckFlush() {
	if (flushScheduled) return;
	if (pendingSuspenseChecks.size === 0) return;
	flushScheduled = true;
	queueMicrotask(flushSuspenseChecks);
}
function flushSuspenseChecks() {
	flushScheduled = false;
	if (pendingSuspenseChecks.size === 0) return;
	const checks = Array.from(pendingSuspenseChecks);
	pendingSuspenseChecks.clear();
	for (const vnode of checks) {
		const rendered = currentVNode(vnode);
		const count = countTopLevelDomNodes(rendered);
		if (count !== 1) appendSuspenseOffsetWarning(pickReportableVNode(rendered), count);
	}
}
function currentVNode(vnode) {
	return vnode.__c?.__v ?? vnode;
}
function pickReportableVNode(vnode) {
	let current = vnode;
	for (let depth = 0; depth < 4; depth++) {
		if (!isLazyWrapperVNode(current)) break;
		const children = current.__k;
		if (!Array.isArray(children) || children.length !== 1) break;
		const child = children[0];
		if (!child || typeof child.type !== "function") break;
		current = currentVNode(child);
	}
	return current;
}
function isLazyWrapperVNode(vnode) {
	const type = vnode.type;
	if (typeof type !== "function") return false;
	const fn = type;
	return fn.displayName === "Lazy" || fn.name === "Lazy";
}
function countTopLevelDomNodes(vnode) {
	if (!vnode || typeof vnode !== "object") return 0;
	const type = vnode.type;
	if (type === null) return 1;
	if (typeof type === "string") return 1;
	const children = vnode.__k;
	if (!Array.isArray(children)) return 0;
	let total = 0;
	for (const child of children) total += countTopLevelDomNodes(child);
	return total;
}
function appendSuspenseOffsetWarning(vnode, count) {
	if (typeof document === "undefined") return;
	appendBannerMessage(`Suspense boundary resolved during hydration: <${getVNodeName(vnode)}> ${count === 0 ? "rendered 0 DOM nodes" : `rendered ${count} DOM nodes`}. Components that unsuspend during hydration must render exactly one DOM node — otherwise sibling offsets can drift and later updates may bind to the wrong nodes.`);
}
function appendHydrationWarning(vnode) {
	appendBannerMessage(`Hydration mismatch detected on <${getVNodeName(vnode)}>. The server-rendered HTML did not match the client.`);
}
function appendBannerMessage(message) {
	if (typeof document === "undefined") return;
	let banner = document.getElementById(HYDRATION_BANNER_ID);
	if (banner) {
		const list = banner.querySelector(`[data-pracht-mismatch-list]`);
		if (list) {
			const item = document.createElement("li");
			item.textContent = message;
			list.appendChild(item);
		}
		return;
	}
	banner = document.createElement("div");
	banner.id = HYDRATION_BANNER_ID;
	banner.setAttribute("role", "alert");
	banner.style.cssText = [
		"position:fixed",
		"top:0",
		"left:0",
		"right:0",
		"z-index:2147483647",
		"background:#1a1a2e",
		"color:#ff6b6b",
		"padding:12px 16px",
		"font:12px/1.5 ui-monospace,Menlo,Consolas,monospace",
		"border-bottom:2px solid #e74c3c",
		"box-shadow:0 2px 8px rgba(0,0,0,0.3)"
	].join(";");
	const title = document.createElement("strong");
	title.textContent = "pracht: hydration mismatch";
	title.style.cssText = "display:block;margin-bottom:4px;color:#fff";
	banner.appendChild(title);
	const list = document.createElement("ul");
	list.setAttribute("data-pracht-mismatch-list", "");
	list.style.cssText = "margin:0;padding-left:18px";
	const item = document.createElement("li");
	item.textContent = message;
	list.appendChild(item);
	banner.appendChild(list);
	document.body.appendChild(banner);
}
function getVNodeName(vnode) {
	if (!vnode) return "Unknown";
	const type = vnode.type;
	if (typeof type === "string") return type;
	if (typeof type === "function") {
		const fn = type;
		return fn.displayName || fn.name || "Component";
	}
	return "Unknown";
}
//#endregion
export { installHydrationMismatchWarning };
