import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
//#region src/build-metadata.ts
const MANIFEST_PATHS = ["dist/client/.vite/manifest.json", "dist/.vite/manifest.json"];
const PRACHT_CLIENT_MODULE_QUERY = "pracht-client";
/**
* `base` prefixes every emitted asset URL, so prerendered documents reference
* their scripts and styles where the deploy actually serves them. Vite
* normalizes it to leading and trailing slashes.
*/
function assetUrl(file, base) {
	return `${base}${file}`;
}
function readClientBuildAssets(root = process.cwd(), base = "/") {
	const manifestPath = MANIFEST_PATHS.map((candidate) => resolve(root, candidate)).find((path) => existsSync(path));
	if (!manifestPath) return {
		clientEntryUrl: null,
		clientEntryJs: [],
		islandsEntryUrl: null,
		islandsEntryJs: [],
		cssManifest: {},
		jsManifest: {}
	};
	const rawManifest = readFileSync(manifestPath, "utf-8");
	const manifest = JSON.parse(rawManifest);
	const clientEntry = manifest["virtual:pracht/client"];
	const islandsEntry = manifest["virtual:pracht/islands-client"];
	function collectTransitiveDeps(key) {
		const css = /* @__PURE__ */ new Set();
		const js = /* @__PURE__ */ new Set();
		const visited = /* @__PURE__ */ new Set();
		function collect(currentKey) {
			if (visited.has(currentKey)) return;
			visited.add(currentKey);
			const entry = manifest[currentKey];
			if (!entry) return;
			for (const cssFile of entry.css ?? []) css.add(cssFile);
			js.add(entry.file);
			for (const importedKey of entry.imports ?? []) collect(importedKey);
		}
		collect(key);
		return {
			css: [...css],
			js: [...js]
		};
	}
	const cssManifest = {};
	const jsManifest = {};
	for (const [key, entry] of Object.entries(manifest)) {
		if (!entry.src) continue;
		const deps = collectTransitiveDeps(key);
		const manifestKey = stripPrachtClientModuleQuery(entry.src);
		if (deps.css.length > 0) cssManifest[manifestKey] = deps.css.map((file) => assetUrl(file, base));
		if (deps.js.length > 0) jsManifest[manifestKey] = deps.js.map((file) => assetUrl(file, base));
	}
	const clientEntryJs = clientEntry ? collectTransitiveDeps("virtual:pracht/client").js.map((file) => assetUrl(file, base)) : [];
	const islandsEntryJs = islandsEntry ? collectTransitiveDeps("virtual:pracht/islands-client").js.map((file) => assetUrl(file, base)) : [];
	addEntryDeps(jsManifest, "virtual:pracht/client", clientEntry, clientEntryJs, base);
	addEntryDeps(jsManifest, "virtual:pracht/islands-client", islandsEntry, islandsEntryJs, base);
	return {
		clientEntryUrl: clientEntry ? assetUrl(clientEntry.file, base) : null,
		clientEntryJs,
		islandsEntryUrl: islandsEntry ? assetUrl(islandsEntry.file, base) : null,
		islandsEntryJs,
		cssManifest,
		jsManifest
	};
}
function addEntryDeps(jsManifest, entryKey, entry, entryJs, base) {
	if (!entry) return;
	const deps = entryJs.filter((url) => url !== assetUrl(entry.file, base));
	if (deps.length > 0) jsManifest[entryKey] = deps;
}
function stripPrachtClientModuleQuery(id) {
	const queryStart = id.indexOf("?");
	if (queryStart === -1) return id;
	const path = id.slice(0, queryStart);
	const query = id.slice(queryStart + 1).split("&").filter((part) => part !== PRACHT_CLIENT_MODULE_QUERY);
	return query.length > 0 ? `${path}?${query.join("&")}` : path;
}
//#endregion
export { readClientBuildAssets as t };
