//#region src/runtime-manifest.ts
const CLIENT_ENTRY_MANIFEST_KEY = "virtual:pracht/client";
const ISLANDS_ENTRY_MANIFEST_KEY = "virtual:pracht/islands-client";
/**
* Merge an entry chunk's own static import urls into a page's modulepreload
* list. Entry deps come first — they gate hydration — and duplicates from the
* page's route/shell chunk closure are dropped.
*/
function mergeEntryPreloadUrls(jsManifest, entryKey, pageUrls) {
	const entryUrls = jsManifest?.[entryKey];
	if (!entryUrls || entryUrls.length === 0) return pageUrls;
	return [...new Set([...entryUrls, ...pageUrls])];
}
/** Strip leading `./` and `/` so all module paths share one canonical form. */
function normalizeModulePath(path) {
	return path.replace(/^\.?\//, "");
}
function buildSuffixIndex(manifest) {
	const index = /* @__PURE__ */ new Map();
	for (const key of Object.keys(manifest)) {
		const normalized = normalizeModulePath(key);
		if (!normalized) continue;
		if (!index.has(normalized)) index.set(normalized, key);
		for (let i = normalized.indexOf("/"); i !== -1; i = normalized.indexOf("/", i + 1)) {
			const suffix = normalized.slice(i + 1);
			if (suffix && !index.has(suffix)) index.set(suffix, key);
		}
	}
	return index;
}
const suffixIndexCache = /* @__PURE__ */ new WeakMap();
function getSuffixIndex(manifest) {
	let index = suffixIndexCache.get(manifest);
	if (index) return index;
	index = buildSuffixIndex(manifest);
	suffixIndexCache.set(manifest, index);
	return index;
}
function resolveManifestEntries(manifest, file) {
	if (file in manifest) return manifest[file];
	const resolved = getSuffixIndex(manifest).get(normalizeModulePath(file));
	if (resolved) return manifest[resolved];
}
function resolvePageUrlsFromManifest(manifest, shellFile, routeFile) {
	const urls = /* @__PURE__ */ new Set();
	const add = (file) => {
		const entries = resolveManifestEntries(manifest, file);
		if (entries) for (const url of entries) urls.add(url);
	};
	if (shellFile) add(shellFile);
	add(routeFile);
	return [...urls];
}
function resolvePageCssUrls(cssManifest, shellFile, routeFile) {
	if (!cssManifest) return [];
	return resolvePageUrlsFromManifest(cssManifest, shellFile, routeFile);
}
function resolvePageJsUrls(jsManifest, shellFile, routeFile) {
	if (!jsManifest) return [];
	return resolvePageUrlsFromManifest(jsManifest, shellFile, routeFile);
}
async function resolveRegistryModule(modules, file) {
	if (!modules) return void 0;
	if (file in modules) return modules[file]();
	const resolved = getSuffixIndex(modules).get(normalizeModulePath(file));
	if (resolved) return modules[resolved]();
}
async function resolveDataFunctions(route, routeModule, registry) {
	let loader = routeModule?.loader;
	let loaderFile = routeModule?.loader ? route.file : void 0;
	if (route.loaderFile) {
		const dataModule = await resolveRegistryModule(registry.dataModules, route.loaderFile);
		if (dataModule?.loader) {
			loader = dataModule.loader;
			loaderFile = route.loaderFile;
		}
	}
	return {
		loader,
		loaderFile
	};
}
//#endregion
export { CLIENT_ENTRY_MANIFEST_KEY, ISLANDS_ENTRY_MANIFEST_KEY, mergeEntryPreloadUrls, resolveDataFunctions, resolveManifestEntries, resolvePageCssUrls, resolvePageJsUrls, resolveRegistryModule };
