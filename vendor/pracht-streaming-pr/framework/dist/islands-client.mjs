import { ISLANDS_HYDRATED_MARKER, ISLAND_ELEMENT, ISLAND_FILE_ATTRIBUTE, ISLAND_HYDRATED_ATTRIBUTE, ISLAND_PROPS_ATTRIBUTE } from "./islands-shared.mjs";
import { CAPABILITY_SETTLED_EVENT } from "@pracht/capabilities";
import { h, hydrate } from "preact";
//#region src/islands-client.ts
let capabilityRevalidationBound = false;
/**
* Islands routes render server-side and mount no client router, so there is no
* route-data store to soft-refresh after a mutation the way full-hydration
* routes do. Reload the document instead when a non-`read` capability settles
* successfully, so loader-rendered content stays consistent with the mutation.
*/
function bindCapabilityRevalidation() {
	if (capabilityRevalidationBound || typeof window === "undefined") return;
	capabilityRevalidationBound = true;
	window.addEventListener(CAPABILITY_SETTLED_EVENT, (event) => {
		const detail = event.detail;
		if (detail?.ok === true && detail.effect !== "read" && detail.revalidate !== false) window.location.reload();
	});
}
async function hydrateIslands(options) {
	bindCapabilityRevalidation();
	const elements = document.querySelectorAll(ISLAND_ELEMENT);
	const immediate = [];
	for (const element of elements) {
		const strategy = element.getAttribute("client") ?? "load";
		if (strategy === "visible") scheduleWhenVisible(element, () => hydrateIsland(element, options));
		else if (strategy === "idle") scheduleWhenIdle(() => hydrateIsland(element, options));
		else immediate.push(hydrateIsland(element, options));
	}
	await Promise.all(immediate);
	document.documentElement.setAttribute(ISLANDS_HYDRATED_MARKER, "true");
}
async function hydrateIsland(element, options) {
	if (element.getAttribute("data-hydrated") === "true") return;
	const file = element.getAttribute(ISLAND_FILE_ATTRIBUTE);
	const exportName = element.getAttribute("export") ?? "default";
	if (!file) return;
	const importer = findIslandModule(options.modules, file);
	if (!importer) {
		console.error(`[pracht] No island module found for "${file}".`);
		return;
	}
	let Component;
	let props = {};
	try {
		const exported = (await importer())?.[exportName];
		if (typeof exported !== "function") {
			console.error(`[pracht] Island module "${file}" has no "${exportName}" component export.`);
			return;
		}
		Component = exported;
		const rawProps = element.getAttribute(ISLAND_PROPS_ATTRIBUTE);
		if (rawProps) props = JSON.parse(rawProps);
	} catch (error) {
		console.error(`[pracht] Failed to load island "${file}":`, error);
		return;
	}
	hydrate(h(Component, props), element);
	element.setAttribute(ISLAND_HYDRATED_ATTRIBUTE, "true");
}
function findIslandModule(modules, file) {
	if (file in modules) return modules[file];
	const normalized = normalizeModuleKey(file);
	for (const key of Object.keys(modules)) if (normalizeModuleKey(key) === normalized) return modules[key];
	return null;
}
function normalizeModuleKey(key) {
	return key.split("?")[0].replace(/^\.?\//, "");
}
function scheduleWhenIdle(task) {
	if (typeof requestIdleCallback === "function") requestIdleCallback(() => task());
	else setTimeout(task, 200);
}
function scheduleWhenVisible(element, task) {
	if (typeof IntersectionObserver === "undefined") {
		task();
		return;
	}
	const targets = element.children.length > 0 ? [...element.children] : [element];
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			observer.disconnect();
			task();
			return;
		}
	});
	for (const target of targets) observer.observe(target);
}
//#endregion
export { hydrateIslands };
