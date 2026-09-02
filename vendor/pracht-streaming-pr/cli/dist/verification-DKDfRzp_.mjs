import { a as formatBytes } from "./bundle-report-lW_Uk3V5.mjs";
import { a as readGraphSnapshotFromDisk, l as resolveLiveGraphMetadata, t as GRAPH_SNAPSHOT_PATH, u as serializeGraphSnapshot } from "./graph-snapshot-C3nG4UBK.mjs";
import { a as readProjectConfig, c as resolveProjectPath, i as listFilesRecursively, n as displayPath, r as hasPagesAppShell } from "./project-C-2I9C0N.mjs";
import { a as isRouteSource, c as normalizeRoutePath, i as isPageSource, l as resolveApiRoutePath, n as MODULE_SOURCE_RE, o as isWithinDirectory, r as createCheck, s as normalizePath, t as CONFIG_FILE_NAMES, u as toModuleSpecifier } from "./verification-helpers-D_Az_Kqg.mjs";
import { n as extractRegistryEntries, r as extractRelativeModulePaths } from "./manifest-D4EPJS5G.mjs";
import { a as readWranglerBundleSettings, i as readWranglerAssetsHtmlHandling, o as readWranglerMainEntries, r as findWranglerConfig, t as detectAdapterTarget } from "./preview-DoGo6ljG.mjs";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { OAUTH_PROTECTED_RESOURCE_WELL_KNOWN, evaluateConstraints, isValidOAuthScopeToken, matchRoutePath } from "@pracht/core";
import { evaluateLiteral, extractCapabilityRegistrations, extractDefineAppObjectBody, extractDefineCapabilityArgs, findTopLevelObjectProperty, maskCommentsAndStrings, scanTopLevelProperties, scanTopLevelPropertyEntries } from "@pracht/capabilities/static";
import { MCP_SCHEMA_ROOT_ERROR, MCP_TOOL_NAME_ERROR, WEBMCP_TOOL_NAME_ERROR, collectInvalidSchemaKeywordValues, collectUnsupportedSchemaKeywords, findMcpToolNameCollisions, isValidCapabilityHttpPath, isValidMcpToolName, isValidWebmcpToolName, mcpToolName } from "@pracht/capabilities";
import { execFileSync } from "node:child_process";
//#region src/verification-pages.ts
function scanPagesDirectory(pagesDir, additionalExtensions = []) {
	return listFilesRecursively(pagesDir).filter((file) => isPageSource(file, additionalExtensions)).map((file) => describePagesFile(pagesDir, file, additionalExtensions));
}
function describePagesFile(pagesDir, file, additionalExtensions = []) {
	const relativePath = relative(pagesDir, file).replace(/\\/g, "/");
	const extensionIndex = relativePath.lastIndexOf(".");
	const routePath = extensionIndex === -1 ? relativePath : relativePath.slice(0, extensionIndex);
	const name = basename(routePath);
	const analysisSource = maskMarkdownFences(readFileSync(file, "utf-8"), relativePath);
	if (hasPagesAppShell(file, additionalExtensions)) return {
		file,
		kind: "shell",
		hasRevalidateExport: extractRevalidate(analysisSource).kind !== "missing"
	};
	if (name.startsWith("_")) return {
		file,
		kind: "ignored"
	};
	const withoutIndex = routePath.replace(/\/index$/, "");
	if (withoutIndex === "404") return {
		file,
		kind: "not-found",
		hasRevalidateExport: extractRevalidate(analysisSource).kind !== "missing"
	};
	if (routePath === "index") return {
		file,
		kind: "route",
		routePath: "/",
		renderMode: extractQuotedExport(analysisSource, "RENDER_MODE"),
		revalidate: extractRevalidate(analysisSource)
	};
	return {
		file,
		kind: "route",
		routePath: normalizeRoutePath(`/${withoutIndex.replace(/\[\.\.\.([^\]]+)\]/g, "*").replace(/\[([^\].]+)\]/g, ":$1")}`),
		renderMode: extractQuotedExport(analysisSource, "RENDER_MODE"),
		revalidate: extractRevalidate(analysisSource)
	};
}
function extractQuotedExport(source, name) {
	const declarations = [...maskCommentsAndStrings(source).matchAll(new RegExp(`export\\s+const\\s+${name}\\s*=`, "g"))];
	if (declarations.length !== 1) return void 0;
	const declaration = declarations[0];
	const valueStart = (declaration.index ?? 0) + declaration[0].length;
	return source.slice(valueStart).trimStart().match(/^["'](\w+)["']/)?.[1];
}
function extractRevalidate(source) {
	const matches = [...maskCommentsAndStrings(source).matchAll(/export\s+const\s+REVALIDATE\s*=\s*([^;\n]+)/g)];
	if (matches.length === 0) return { kind: "missing" };
	if (matches.length > 1) return {
		kind: "invalid",
		expression: "duplicate exports"
	};
	const expression = matches[0][1].trim().replace(/\s+as\s+const$/, "");
	if (!/^\d(?:_?\d)*$/.test(expression)) return {
		kind: "invalid",
		expression
	};
	const seconds = Number(expression.replaceAll("_", ""));
	if (!Number.isSafeInteger(seconds) || seconds <= 0) return {
		kind: "invalid",
		expression
	};
	return {
		kind: "time",
		seconds
	};
}
/** Mask Markdown fenced examples while preserving source offsets and top-level MDX exports. */
function maskMarkdownFences(source, relativePath) {
	if (!/\.mdx?$/.test(relativePath)) return source;
	const chars = source.split("");
	let activeFence = null;
	for (const line of source.matchAll(/.*(?:\r?\n|$)/g)) {
		if (line[0] === "") continue;
		const lineStart = line.index ?? 0;
		const stripped = stripMarkdownContainerPrefix(line[0].replace(/\r?\n$/, ""));
		const fenceContent = activeFence && stripped.content.startsWith(" ".repeat(activeFence.continuationIndent)) ? stripped.content.slice(activeFence.continuationIndent) : stripped.content;
		const opening = activeFence ? null : /^ {0,3}(`{3,}|~{3,})/.exec(fenceContent);
		const closing = activeFence ? new RegExp(`^ {0,3}\\${activeFence.character}{${activeFence.length},}[ \\t]*$`).test(fenceContent) : false;
		if (activeFence || opening) for (let offset = 0; offset < line[0].length; offset += 1) {
			const index = lineStart + offset;
			if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
		}
		if (closing) activeFence = null;
		else if (opening) activeFence = {
			character: opening[1][0],
			continuationIndent: stripped.continuationIndent,
			length: opening[1].length
		};
	}
	return chars.join("");
}
function stripMarkdownContainerPrefix(line) {
	let content = line;
	let continuationIndent = 0;
	while (true) {
		const quote = /^ {0,3}> ?/.exec(content);
		if (quote) {
			content = content.slice(quote[0].length);
			continue;
		}
		const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(content);
		if (!list) return {
			content,
			continuationIndent
		};
		continuationIndent += list[0].length;
		content = content.slice(list[0].length);
	}
}
function collectDuplicateRoutePaths(routes) {
	const routeMap = /* @__PURE__ */ new Map();
	for (const route of routes) {
		const files = routeMap.get(route.routePath) ?? [];
		files.push(route.file);
		routeMap.set(route.routePath, files);
	}
	return [...routeMap.entries()].filter(([, files]) => files.length > 1).map(([path, files]) => ({
		files,
		path
	}));
}
//#endregion
//#region src/verification-checks.ts
const SERVER_ENTRY_PATH = "dist/server/server.js";
function collectConfigChecks(project, checks, configDisplayPath) {
	if (!project.configFile) checks.push(createCheck("error", "Missing vite config."));
	else checks.push(createCheck("ok", `Found ${configDisplayPath}.`));
	if (!project.hasPrachtPlugin) checks.push(createCheck("error", "vite.config does not appear to register the pracht plugin."));
	else checks.push(createCheck("ok", "Vite config registers the pracht plugin."));
	if (!project.additionalExtensionsIsStatic) checks.push(createCheck("warning", "additionalExtensions could not be resolved statically. The live Vite configuration still controls builds, but static route verification cannot classify custom-format files reliably. Use an inline string array or a const string array when possible."));
}
function collectManifestVerification(project, checks, { changedFiles, scope }) {
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	if (!existsSync(manifestPath)) {
		checks.push(createCheck("error", `App manifest is missing at ${project.appFile}.`));
		return;
	}
	const source = readFileSync(manifestPath, "utf-8");
	const relativeModules = [...extractRelativeModulePaths(source)];
	const routeCount = (source.match(/\broute\s*\(/g) ?? []).length;
	if (scope === "full") {
		checks.push(createCheck("ok", `Found app manifest at ${project.appFile}.`));
		if (routeCount === 0) checks.push(createCheck("warning", "No routes were found in the app manifest."));
		else checks.push(createCheck("ok", `App manifest defines ${routeCount} route${routeCount === 1 ? "" : "s"}.`));
		const shellEntries = extractRegistryEntries(source, "shells");
		const middlewareEntries = extractRegistryEntries(source, "middleware");
		if (shellEntries.length > 0) checks.push(createCheck("ok", `Registered ${shellEntries.length} shell${shellEntries.length === 1 ? "" : "s"}.`));
		if (middlewareEntries.length > 0) {
			checks.push(createCheck("ok", `Registered ${middlewareEntries.length} middleware module${middlewareEntries.length === 1 ? "" : "s"}.`));
			collectMiddlewareExportChecks(checks, manifestPath, middlewareEntries);
		}
		const missingModules = relativeModules.map((modulePath) => ({
			display: modulePath,
			exists: existsSync(resolve(dirname(manifestPath), modulePath))
		})).filter((entry) => !entry.exists).map((entry) => entry.display);
		if (missingModules.length > 0) checks.push(createCheck("error", `Manifest references missing files: ${missingModules.map((item) => JSON.stringify(item)).join(", ")}.`));
		else checks.push(createCheck("ok", `All ${relativeModules.length} manifest module path${relativeModules.length === 1 ? "" : "s"} resolve.`));
	} else collectChangedManifestModuleChecks(project, checks, manifestPath, relativeModules, changedFiles);
	collectMarkdownTransformCheck(project, checks, relativeModules.map((modulePath) => resolve(dirname(manifestPath), modulePath)));
}
/**
* Whether `source` exports a binding *named* `middleware`.
*
* Comments and string literals are masked first, and the `export { … }` clause
* is read for the exported name rather than pattern-matched: `export
* { middleware as default }` mentions the word but exports nothing called
* `middleware`, and that is exactly the mistake this check exists to catch.
* A re-export (`export * from`) is treated as a match because its names cannot
* be known without resolving the other module — better to miss one than to
* fail a working app.
*/
/**
* Whether a destructuring pattern binds a variable named `middleware`.
*
* `{ middleware }` and `[middleware]` do; `{ middleware: mw }` binds `mw`, and
* `{ mw: middleware }` binds `middleware`. Renames are the whole point, so the
* check reads which side of the `:` each name sits on.
*/
function bindsMiddleware(pattern) {
	const parts = splitTopLevel(pattern.slice(1, -1));
	if (pattern.startsWith("[")) return parts.some((element) => bindsName(element));
	return parts.some((property) => {
		const separator = topLevelIndexOf(property, ":");
		return bindsName(separator === -1 ? property : property.slice(separator + 1));
	});
}
function bindsName(text) {
	const bound = text.trim().replace(/^\.\.\./, "").replace(/\s*=.*$/, "").trim();
	if (bound.startsWith("{") || bound.startsWith("[")) return bindsMiddleware(bound);
	return bound === "middleware";
}
/** Split on commas that are not inside a nested `{}` / `[]` / `()`. */
function splitTopLevel(text) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "{" || char === "[" || char === "(") depth += 1;
		else if (char === "}" || char === "]" || char === ")") depth -= 1;
		else if (char === "," && depth === 0) {
			parts.push(text.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}
/** Index of the first `needle` at nesting depth 0, or -1. */
function topLevelIndexOf(text, needle) {
	let depth = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "{" || char === "[" || char === "(") depth += 1;
		else if (char === "}" || char === "]" || char === ")") depth -= 1;
		else if (char === needle && depth === 0) return index;
	}
	return -1;
}
/**
* Every destructuring pattern in an `export const|let|var` declaration.
*
* Scanned with a delimiter counter rather than a regex: a non-greedy match
* stops at the first `}`, truncating a nested pattern
* (`{ auth: { middleware } }`), and the optional type annotation between the
* pattern and `=` is easier to skip explicitly than to express.
*/
function destructuredExportPatterns(code) {
	const patterns = [];
	for (const match of code.matchAll(/export\s+(?:const|let|var)\s*(?=[{[])/g)) {
		const open = (match.index ?? 0) + match[0].length;
		const close = matchingDelimiter(code, open);
		if (close === -1) continue;
		if (!/^\s*(?::[^=]*)?=/.test(code.slice(close + 1))) continue;
		patterns.push(code.slice(open, close + 1));
	}
	return patterns;
}
/** Index of the delimiter closing the one at `open`, or -1. */
function matchingDelimiter(code, open) {
	let depth = 0;
	for (let index = open; index < code.length; index += 1) {
		const char = code[index];
		if (char === "{" || char === "[" || char === "(") depth += 1;
		else if (char === "}" || char === "]" || char === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}
function exportsMiddleware(source) {
	const code = maskCommentsAndStrings(source);
	if (/export\s+(?:async\s+)?(?:function|const|let|var)\s+middleware\b/.test(code)) return true;
	for (const pattern of destructuredExportPatterns(code)) if (bindsMiddleware(pattern)) return true;
	if (/export\s*\*\s*from/.test(code)) return true;
	for (const clause of code.matchAll(/export\s*\{([^}]*)\}/g)) for (const specifier of clause[1].split(",")) {
		const parts = specifier.trim().split(/\s+as\s+/);
		if (parts.length === 0 || parts[0] === "") continue;
		if ((parts.length > 1 ? parts[parts.length - 1] : parts[0]).trim() === "middleware") return true;
	}
	return false;
}
/**
* A registered middleware module that does not export `middleware` used to be
* skipped at runtime, so an auth gate could be wired in the manifest and
* absent in production while every check here passed. The runtime now refuses
* to serve such a route; this check reports the same mistake before a request
* ever reaches it.
*/
function collectMiddlewareExportChecks(checks, manifestPath, entries) {
	const manifestDir = dirname(manifestPath);
	const missing = [];
	for (const entry of entries) {
		const file = resolve(manifestDir, entry.path);
		if (!existsSync(file)) continue;
		if (!exportsMiddleware(readFileSync(file, "utf-8"))) missing.push(`${entry.name} (${entry.path})`);
	}
	if (missing.length === 0) {
		checks.push(createCheck("ok", `All ${entries.length} middleware module(s) export \`middleware\`.`));
		return;
	}
	checks.push(createCheck("error", `Middleware module(s) without a \`middleware\` export: ${missing.join(", ")}. Middleware must \`export const middleware: MiddlewareFn = (args, next) => …\` (a default export is not used); routes referencing them fail at request time.`));
}
function collectChangedManifestModuleChecks(project, checks, manifestPath, relativeModules, changedFiles) {
	const manifestDir = dirname(manifestPath);
	const referencedModules = new Set(relativeModules.map(normalizePath));
	const moduleDirectories = [
		{
			additionalExtensions: true,
			dir: resolveProjectPath(project.root, project.routesDir),
			label: "route module"
		},
		{
			additionalExtensions: true,
			dir: resolveProjectPath(project.root, project.shellsDir),
			label: "shell module"
		},
		{
			additionalExtensions: false,
			dir: resolveProjectPath(project.root, project.middlewareDir),
			label: "middleware module"
		},
		{
			additionalExtensions: false,
			dir: resolveProjectPath(project.root, project.serverDir),
			label: "server module"
		}
	];
	for (const file of changedFiles) {
		const directory = moduleDirectories.find((entry) => isWithinDirectory(file, entry.dir));
		if (!directory) continue;
		if (!(directory.additionalExtensions ? isRouteSource(file, project.additionalExtensions) : MODULE_SOURCE_RE.test(file))) continue;
		const display = displayPath(project.root, file);
		const modulePath = normalizePath(toModuleSpecifier(manifestDir, file));
		const exists = existsSync(file);
		if (referencedModules.has(modulePath)) {
			if (exists) checks.push(createCheck("ok", `Changed ${directory.label} ${JSON.stringify(display)} is referenced by the app manifest.`));
			else checks.push(createCheck("error", `Changed ${directory.label} ${JSON.stringify(display)} was removed but is still referenced by the app manifest.`));
			continue;
		}
		if (exists) checks.push(createCheck("warning", `Changed ${directory.label} ${JSON.stringify(display)} is not referenced by the app manifest.`));
	}
}
function collectPagesVerification(project, checks, { changedFiles, scope }) {
	const pagesDir = resolveProjectPath(project.root, project.pagesDir);
	if (!existsSync(pagesDir)) {
		checks.push(createCheck("error", `Pages directory is missing at ${project.pagesDir}.`));
		return;
	}
	const pages = scanPagesDirectory(pagesDir, project.additionalExtensions);
	const routes = pages.filter((page) => page.kind === "route");
	const notFoundPages = pages.filter((page) => page.kind === "not-found");
	const appShells = pages.filter((page) => page.kind === "shell");
	const duplicates = collectDuplicateRoutePaths(routes).map((entry) => ({
		...entry,
		files: entry.files.map((file) => displayPath(project.root, file))
	}));
	if (!project.pagesDefaultRenderIsStatic) checks.push(createCheck("warning", "pagesDefaultRender could not be resolved statically. The build evaluates the live configuration and will still reject ISG pages without a revalidation policy."));
	else if (!new Set([
		"spa",
		"ssr",
		"ssg",
		"isg"
	]).has(project.pagesDefaultRender)) checks.push(createCheck("error", "pagesDefaultRender must resolve to \"spa\", \"ssr\", \"ssg\", or \"isg\"."));
	for (const shell of appShells) if (shell.hasRevalidateExport) checks.push(createCheck("error", `Pages app shell ${JSON.stringify(displayPath(project.root, shell.file))} exports REVALIDATE, but app shells are not ISG routes. Declare the policy on each ISG page instead.`));
	for (const page of notFoundPages) if (page.hasRevalidateExport) checks.push(createCheck("error", `Pages not-found module ${JSON.stringify(displayPath(project.root, page.file))} exports REVALIDATE, but not-found responses are never ISG routes.`));
	for (const route of routes) {
		const display = displayPath(project.root, route.file);
		const render = route.renderMode ?? (project.pagesDefaultRenderIsStatic ? project.pagesDefaultRender : void 0);
		if (route.revalidate.kind === "invalid") {
			checks.push(createCheck("error", `Pages route ${JSON.stringify(display)} must export REVALIDATE as a positive integer literal number of seconds (for example, \`export const REVALIDATE = 60\`).`));
			continue;
		}
		if (render === "isg" && route.revalidate.kind === "missing") {
			checks.push(createCheck("error", `Pages route ${JSON.stringify(display)} uses render mode "isg" but does not export a revalidation policy. Add \`export const REVALIDATE = 60\` with a positive integer number of seconds, or use another render mode.`));
			continue;
		}
		if (render === void 0 && route.revalidate.kind === "time") {
			checks.push(createCheck("error", `Pages route ${JSON.stringify(display)} exports REVALIDATE, but its effective render mode cannot be resolved statically. Export \`RENDER_MODE = "isg"\` on the page or use a statically resolvable pagesDefaultRender value.`));
			continue;
		}
		if (render !== "isg" && route.revalidate.kind === "time") checks.push(createCheck("error", `Pages route ${JSON.stringify(display)} exports REVALIDATE but its effective render mode is ${JSON.stringify(render)}. REVALIDATE is only valid with \`RENDER_MODE = "isg"\` (or \`pagesDefaultRender: "isg"\`).`));
	}
	if (scope === "full") {
		checks.push(createCheck("ok", `Found pages directory at ${project.pagesDir}.`));
		if (routes.length === 0) checks.push(createCheck("warning", "Pages router app does not contain any route files yet."));
		else checks.push(createCheck("ok", `Found ${routes.length} page route${routes.length === 1 ? "" : "s"}.`));
		if (!pages.some((page) => page.kind === "shell")) checks.push(createCheck("warning", "No `_app` shell was found in the pages directory."));
		else checks.push(createCheck("ok", "Found a pages-router `_app` shell."));
		if (notFoundPages.length === 1) checks.push(createCheck("ok", "Found a pages-router not-found page."));
	} else collectChangedPagesChecks(project, checks, pagesDir, changedFiles);
	collectMarkdownTransformCheck(project, checks, pages.filter((page) => page.kind === "route" || page.kind === "not-found").map((page) => page.file));
	if (notFoundPages.length > 1) checks.push(createCheck("error", `Pages router resolves multiple not-found pages: ${notFoundPages.map((page) => JSON.stringify(displayPath(project.root, page.file))).join(", ")}. Only one file may resolve to "/404".`));
	if (duplicates.length > 0) checks.push(createCheck("error", `Pages router resolves duplicate paths: ${duplicates.map((entry) => `${JSON.stringify(entry.path)} from ${entry.files.map((file) => JSON.stringify(file)).join(", ")}`).join("; ")}.`));
	else if (scope === "full" && routes.length > 0) checks.push(createCheck("ok", `Pages router resolved ${routes.length} route${routes.length === 1 ? "" : "s"} without path collisions.`));
}
const MARKDOWN_PAGE_RE = /\.(?:mdx?|markdown)$/;
const MARKDOWN_PLUGIN_HINTS = [
	"@mdx-js/rollup",
	"vite-plugin-mdx",
	"vite-plugin-markdown"
];
const CONTENT_REGISTRY_HINT = "@pracht/content/vite";
/**
* A `.md`, `.markdown`, or `.mdx` route is registered like any other, but nothing renders it
* unless a transform plugin is configured: Vite hands the raw Markdown to the
* JS parser, so the route 500s at request time with `Invalid Character` and
* `pracht build` fails with a raw parser stack. Both `doctor` and `verify`
* would otherwise report the app healthy.
*/
function collectMarkdownTransformCheck(project, checks, files) {
	const markdownFiles = files.filter((file) => MARKDOWN_PAGE_RE.test(file));
	if (markdownFiles.length === 0) return;
	const config = project.rawConfig;
	if (MARKDOWN_PLUGIN_HINTS.some((hint) => config.includes(hint))) return;
	const shown = markdownFiles.slice(0, 3).map((file) => JSON.stringify(displayPath(project.root, file))).join(", ");
	const summary = `${markdownFiles.length} Markdown route${markdownFiles.length === 1 ? "" : "s"} (${shown}${markdownFiles.length > 3 ? ", ..." : ""})`;
	checks.push(createCheck("warning", config.includes(CONTENT_REGISTRY_HINT) ? `${summary} with \`prachtContent()\` configured. Static verification cannot tell whether its collections register these sources, and Pracht does not otherwise transform Markdown: any route no collection owns reaches Vite's JS parser and fails at request and build time. \`pracht build\` resolves the registry and reports them.` : `${summary} but no known Markdown transform plugin in the vite config. Pracht does not transform Markdown: without a plugin such as \`@mdx-js/rollup\` registered alongside \`pracht()\`, Vite hands the raw source to the JS parser and these routes fail at request and build time. Ignore this if you register a custom or re-exported Markdown plugin.`));
}
function collectChangedPagesChecks(project, checks, pagesDir, changedFiles) {
	for (const file of changedFiles) {
		if (!isWithinDirectory(file, pagesDir)) continue;
		if (!isPageSource(file, project.additionalExtensions)) continue;
		const display = displayPath(project.root, file);
		if (!existsSync(file)) {
			checks.push(createCheck("ok", `Removed page file ${JSON.stringify(display)} is no longer auto-discovered.`));
			continue;
		}
		const page = describePagesFile(pagesDir, file, project.additionalExtensions);
		if (page.kind === "shell") {
			checks.push(createCheck("ok", `Changed pages shell ${JSON.stringify(display)} will wrap auto-discovered routes.`));
			continue;
		}
		if (page.kind === "ignored") {
			checks.push(createCheck("warning", `Changed pages file ${JSON.stringify(display)} is ignored by the pages router.`));
			continue;
		}
		if (page.kind === "not-found") {
			checks.push(createCheck("ok", `Changed pages not-found file ${JSON.stringify(display)} is wired automatically.`));
			continue;
		}
		checks.push(createCheck("ok", `Changed page route ${JSON.stringify(display)} resolves to ${JSON.stringify(page.routePath)}.`));
	}
}
function collectApiVerification(project, checks, { changedFiles, scope }) {
	const apiDir = resolveProjectPath(project.root, project.apiDir);
	const changedApiFiles = changedFiles.filter((file) => isWithinDirectory(file, apiDir));
	if (scope === "changed" && changedApiFiles.length === 0) return;
	if (!existsSync(apiDir)) {
		if (scope === "full") checks.push(createCheck("ok", `No API directory was found at ${project.apiDir}; skipping API discovery.`));
		return;
	}
	const apiFiles = listFilesRecursively(apiDir).filter((file) => MODULE_SOURCE_RE.test(file));
	const routeMap = /* @__PURE__ */ new Map();
	for (const file of apiFiles) {
		const routePath = resolveApiRoutePath(apiDir, file);
		const display = displayPath(project.root, file);
		const entries = routeMap.get(routePath) ?? [];
		entries.push(display);
		routeMap.set(routePath, entries);
	}
	const duplicates = [...routeMap.entries()].filter(([, files]) => files.length > 1).map(([path, files]) => ({
		files,
		path
	}));
	if (duplicates.length > 0) checks.push(createCheck("error", `API route discovery resolves duplicate paths: ${duplicates.map((entry) => `${JSON.stringify(entry.path)} from ${entry.files.map((file) => JSON.stringify(file)).join(", ")}`).join("; ")}.`));
	else if (scope === "full") checks.push(createCheck("ok", `API route discovery resolved ${apiFiles.length} route${apiFiles.length === 1 ? "" : "s"}.`));
	for (const file of changedApiFiles) {
		if (!MODULE_SOURCE_RE.test(file)) continue;
		const display = displayPath(project.root, file);
		if (!existsSync(file)) {
			checks.push(createCheck("ok", `Removed API route ${JSON.stringify(display)} is no longer auto-discovered.`));
			continue;
		}
		checks.push(createCheck("ok", `Changed API route ${JSON.stringify(display)} resolves to ${JSON.stringify(resolveApiRoutePath(apiDir, file))}.`));
	}
}
function collectBudgetChecks(project, checks) {
	const reportPath = resolve(project.root, "dist/server/budget-report.json");
	if (!existsSync(reportPath)) return;
	let report;
	try {
		report = JSON.parse(readFileSync(reportPath, "utf-8"));
	} catch {
		checks.push(createCheck("warning", "dist/server/budget-report.json exists but could not be parsed."));
		return;
	}
	const results = report.results ?? [];
	if (results.length === 0) return;
	const failed = results.filter((result) => !result.ok);
	if (failed.length === 0) {
		checks.push(createCheck("ok", `All ${results.length} route client JS budget${results.length === 1 ? "" : "s"} pass (from the last \`pracht build\`).`));
		return;
	}
	for (const result of failed) checks.push(createCheck("error", `Route ${JSON.stringify(result.path)} exceeds its client JS budget: ${formatBytes(result.gzipBytes)} gzip > ${formatBytes(result.limitBytes)} (from the last \`pracht build\`).`));
}
function collectPackageChecks(project, checks, packageJsonPath) {
	if (!existsSync(packageJsonPath)) {
		checks.push(createCheck("warning", "No package.json found in the current app root."));
		return;
	}
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
	const deps = {
		...packageJson.dependencies,
		...packageJson.devDependencies
	};
	if (!("@pracht/cli" in deps)) checks.push(createCheck("warning", "`@pracht/cli` is not listed in package.json dependencies."));
	const adapterPackages = Object.keys(deps).filter((name) => name.startsWith("@pracht/adapter-"));
	if (adapterPackages.length === 0) checks.push(createCheck("warning", "No built-in pracht adapter dependency was found in package.json."));
	else checks.push(createCheck("ok", `Found adapter dependency ${adapterPackages.map((name) => JSON.stringify(name)).join(", ")}.`));
	collectCapabilitiesDependencyCheck(project, deps, checks);
	collectCloudflareEntryCheck(project, dirname(packageJsonPath), checks);
}
/**
* Capability modules import `defineCapability` from `@pracht/capabilities`,
* which is a separate package the app has to install. Without it the registry
* fails to resolve at request time (`internal_error`) and — more confusingly —
* every capability's metadata reads as unknown, so the dev banner and
* `pracht inspect capabilities` report exposed capabilities as `private` with
* no effect class.
*/
function collectCapabilitiesDependencyCheck(project, deps, checks) {
	if (project.mode !== "manifest") return;
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	if (!existsSync(manifestPath)) return;
	if (extractRegistryEntries(readFileSync(manifestPath, "utf-8"), "capabilities").length === 0) return;
	if ("@pracht/capabilities" in deps) {
		checks.push(createCheck("ok", "Found capability dependency \"@pracht/capabilities\"."));
		return;
	}
	checks.push(createCheck("error", "The app registers capabilities but `@pracht/capabilities` is not in package.json. Install it (`npm install @pracht/capabilities`) — without it capability dispatch answers 500 at runtime and capability metadata reads as private/unknown in the dev banner and `pracht inspect capabilities`."));
}
/**
* `dist/server/server.js` also exports the build metadata the CLI's prerender
* pass needs (buildTarget, manifests, the resolved app, ...). workerd validates
* every named export of the deployed entry module and refuses to start when one
* of them is not a handler, so pointing `main` at it fails at `wrangler dev` /
* `wrangler deploy` time with an opaque type error. `pracht build` writes
* `dist/server/worker.js` for exactly this reason.
*
* Reported as a warning, and only ever about an entry that was actually read.
* Two things here are heuristics — which adapter the vite config resolves to
* (a text match) and which `main` entries a wrangler config declares (a
* conservative reader that skips shapes it does not recognize) — so this must
* not be able to fail a build. It stays silent when nothing is provably wrong
* rather than claiming the config is fine: "no entries read" means unknown,
* not correct.
*/
function collectCloudflareEntryCheck(project, root, checks) {
	if (detectAdapterTarget(project) !== "cloudflare") return;
	const configFile = findWranglerConfig(root);
	if (!configFile) return;
	const display = displayPath(root, configFile);
	collectCloudflareTrailingSlashCheck(project, root, configFile, display, checks);
	for (const bundling of readWranglerBundleSettings(configFile) ?? []) {
		if (bundling.noBundle === true && bundling.hasJavaScriptModuleRule) continue;
		const where = bundling.environment ? ` for environment "${bundling.environment}"` : "";
		checks.push(createCheck("warning", `${display}${where} does not preserve Pracht's Vite output as separate Worker modules. Pracht may emit deferred server chunks; Wrangler's default second bundle folds those chunks back into the entry file. Add "no_bundle": true and an ESModule rule whose globs include "**/*.js" so Wrangler uploads the build output unchanged.`));
	}
	for (const entry of readWranglerMainEntries(configFile)) {
		if (!normalizePath(entry.main).endsWith(SERVER_ENTRY_PATH)) continue;
		const where = entry.environment ? ` for environment "${entry.environment}"` : "";
		checks.push(createCheck("warning", `${display} sets "main"${where} to ${JSON.stringify(entry.main)}. Point it at "dist/server/worker.js" — the deploy entry \`pracht build\` emits. workerd rejects server.js because it also exports build metadata that is not a Worker handler.`));
	}
}
/**
* Cloudflare's assets binding defaults to `html_handling: "auto-trailing-slash"`,
* which answers `GET /guide` with a 307 to `/guide/`. Node and Vercel answer
* `200`, so the canonical URL of every prerendered route differs by adapter —
* and the generated `llms.txt` emits the non-slash form, sending agents through
* a redirect on Cloudflare only.
*
* `create-pracht` writes `"drop-trailing-slash"` into new Cloudflare scaffolds;
* this catches the apps that predate it. Warning-only and silent whenever
* anything is unproven: a TOML config, an unparsable file, no assets block, or
* an app with nothing prerendered to redirect.
*/
function collectCloudflareTrailingSlashCheck(project, root, configFile, display, checks) {
	const assets = readWranglerAssetsHtmlHandling(configFile);
	if (!assets || assets.htmlHandling !== void 0) return;
	if (!appHasPrerenderedRoutes(project, root)) return;
	checks.push(createCheck("warning", `${display} does not set "assets.html_handling". Cloudflare's default redirects every prerendered route to its trailing-slash form (307), so its canonical URL differs from Node and Vercel. Add "html_handling": "drop-trailing-slash" (or "none" when you do your own routing).`));
}
/**
* Whether the app plausibly emits prerendered HTML. Proven from build output
* when there is any, and otherwise inferred from declared render modes — the
* same text-level heuristic the surrounding Cloudflare checks already accept,
* because the only consequence of being wrong is a suppressed suggestion.
*/
function appHasPrerenderedRoutes(project, root) {
	const clientDir = resolve(root, "dist/client");
	if (existsSync(clientDir)) return listFilesRecursively(clientDir).some((file) => file.endsWith(".html"));
	const sourceDir = project.mode === "manifest" ? resolveProjectPath(project.root, project.appFile) : resolveProjectPath(project.root, project.pagesDir);
	if (!existsSync(sourceDir)) return false;
	return (statSync(sourceDir).isDirectory() ? listFilesRecursively(sourceDir).filter((file) => project.mode === "pages" ? isPageSource(file, project.additionalExtensions) : isRouteSource(file, project.additionalExtensions)) : [sourceDir]).some((file) => {
		let source;
		try {
			source = readFileSync(file, "utf-8");
		} catch {
			return false;
		}
		return /["']ssg["']|["']isg["']/.test(source);
	});
}
//#endregion
//#region src/verification-capabilities.ts
const CAPABILITY_EFFECTS = new Set([
	"read",
	"write",
	"destructive"
]);
const AGENT_POLICIES = new Set(["observe", "require"]);
const MCP_CONFIG_KEYS = new Set([
	"path",
	"serverInfo",
	"instructions",
	"destructive",
	"auth"
]);
const MCP_AUTH_CONFIG_KEYS = new Set([
	"resource",
	"authorizationServers",
	"scopesSupported",
	"requiredScopes",
	"resourceDocumentation",
	"verify"
]);
/**
* Static verification of registered capabilities (manifest mode only). These
* checks mirror what `defineCapability()` and the runtime registry enforce,
* but run without executing application code so `pracht verify` stays fast
* and safe. Spec security rule 1: exposed capabilities without a full
* contract (description, input, output, effect) fail verification. Spec rule
* 3: destructive capabilities may only be exposed over HTTP and remote MCP,
* and only when the prepare/commit confirmation secret
* (PRACHT_CONFIRMATION_SECRET) is configured in the environment `pracht verify`
* runs in — MCP additionally needs the `agents.mcp.destructive` opt-in and a
* registered approval store.
*/
function collectCapabilityChecks(project, checks) {
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	if (!existsSync(manifestPath)) return;
	const manifestSource = readFileSync(manifestPath, "utf-8");
	const entries = extractCapabilityRegistrations(manifestSource).map(({ name, file }) => ({
		name,
		path: file
	}));
	collectMcpAuthChecks(project, manifestPath, manifestSource, checks);
	if (entries.length === 0) return;
	const registeredMiddleware = new Set(extractRegistryEntries(manifestSource, "middleware").map((entry) => entry.name));
	checks.push(createCheck("ok", `Registered ${entries.length} capabilit${entries.length === 1 ? "y" : "ies"}.`));
	const manifestDir = dirname(manifestPath);
	const httpExposedNames = [];
	const mcpExposed = [];
	const destructiveMcpExposed = [];
	const projection = readMcpProjectionConfig(manifestSource);
	const appAgentPolicy = readAppAgentPolicyDefault(manifestSource);
	for (const entry of entries) {
		const rootRelative = entry.path.startsWith("/");
		const filePath = rootRelative ? resolveProjectPath(project.root, entry.path) : resolve(manifestDir, entry.path);
		if (!existsSync(filePath)) {
			if (rootRelative) checks.push(createCheck("error", `Capability ${JSON.stringify(entry.name)} references missing file ${JSON.stringify(entry.path)}.`));
			continue;
		}
		const source = readFileSync(filePath, "utf-8");
		if (hasValidStaticHttpExposure(source)) httpExposedNames.push(entry.name);
		collectSingleCapabilityChecks(entry.name, entry.path, source, registeredMiddleware, checks, {
			mcpExposed,
			destructiveMcpExposed,
			projection,
			appAgentPolicy
		});
	}
	collectShadowedNameChecks(httpExposedNames, checks);
	collectMcpProjectionChecks(mcpExposed, projection, checks);
	collectDestructiveMcpChecks(destructiveMcpExposed, projection, project, checks);
}
function readMcpProjectionConfig(manifestSource) {
	const appBody = extractDefineAppObjectBody(manifestSource);
	const agentsBody = readInlineObjectBody(appBody ? scanTopLevelProperties(appBody).get("agents") : void 0);
	if (agentsBody === null) return {
		configured: false,
		destructive: false
	};
	const mcp = scanTopLevelProperties(agentsBody).get("mcp");
	if (mcp === void 0) return {
		configured: false,
		destructive: false
	};
	const mcpBody = readInlineObjectBody(mcp);
	return {
		configured: true,
		destructive: mcpBody !== null && evaluateLiteral(scanTopLevelProperties(mcpBody).get("destructive") ?? "") === true
	};
}
function readInlineObjectBody(value) {
	if (value === void 0) return null;
	const trimmed = value.trim();
	return trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : null;
}
/**
* Destructive tools on the MCP surface are the one exposure that needs state:
* the confirmation token travels to the same agent that will commit with it, so
* only a durable approval store makes the commit exactly-once.
*
* Both checks here are warnings, deliberately. Neither fact is decidable from
* source: the manifest may assemble `agents` elsewhere, and the store may be
* registered by a workspace package this scan never reads. The gate that
* actually holds is the runtime's — the MCP endpoint refuses to serve a
* destructive tool when the store, the confirmation secret, or a resolvable
* principal is missing — so a static grep must report, not hard-block.
*/
function collectDestructiveMcpChecks(destructiveMcpExposed, projection, project, checks) {
	if (destructiveMcpExposed.length === 0) return;
	const names = destructiveMcpExposed.map((name) => JSON.stringify(name)).join(", ");
	if (!projection.destructive) {
		if (projection.configured) checks.push(createCheck("warning", `Capabilities ${names} are destructive and set expose.mcp, but the manifest does not set agents.mcp.destructive — the projection filters them out at serve time. Add \`agents: { mcp: { destructive: true } }\` (with an approval store) or drop expose.mcp.`));
		return;
	}
	const scan = scanForApprovalStore(project);
	if (!scan.found) {
		checks.push(createCheck("warning", `agents.mcp.destructive is enabled, but no \`setCapabilityApprovalStore(\` call was found in ${scan.searched.join(", ")}. Destructive MCP commits must be exactly-once: register a durable approval store (createSqlApprovalStore from @pracht/core/server) from a server-only module, imported by a server entry or a capability module. The MCP endpoint refuses to serve destructive tools without one. Ignore this if the registration lives outside those directories (a workspace package, say).`));
		return;
	}
	checks.push(createCheck("ok", `Destructive MCP tools (${names}) are opted in and a setCapabilityApprovalStore() call exists in the scanned source. The runtime still verifies that the module loaded and a store is registered before serving them.`));
}
/**
* Conservative source scan for a store registration, over the directories the
* project actually configures. It ignores comments and literals, but cannot
* prove the module is imported — only that source contains a call-shaped
* registration — which is why its absence is a warning and the runtime fails
* closed regardless.
*/
function scanForApprovalStore(project) {
	const configured = [
		project.serverDir,
		project.capabilitiesDir,
		dirname(project.appFile)
	];
	const searched = [...new Set(configured)];
	for (const dir of searched) {
		const root = resolveProjectPath(project.root, dir);
		if (!existsSync(root)) continue;
		let entries;
		try {
			entries = readdirSync(root, { recursive: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!/\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry)) continue;
			try {
				const source = maskCommentsAndStrings(readFileSync(resolve(root, entry), "utf-8"));
				if (/\bsetCapabilityApprovalStore\s*\(/.test(source)) return {
					found: true,
					searched
				};
			} catch {}
		}
	}
	return {
		found: false,
		searched
	};
}
/**
* Checks that only make sense across the whole graph: MCP tool names have to
* be unique, and `expose.mcp` does nothing until the app configures
* `agents.mcp`.
*/
function collectMcpProjectionChecks(mcpExposed, projection, checks) {
	if (mcpExposed.length === 0) return;
	for (const collision of findMcpToolNameCollisions(mcpExposed)) checks.push(createCheck("error", `Capabilities ${collision.capabilities.map((name) => JSON.stringify(name)).join(" and ")} both project to the MCP tool name ${JSON.stringify(collision.toolName)} (dots become underscores). Rename one — the runtime refuses to serve an ambiguous tool list.`));
	if (!projection.configured) checks.push(createCheck("warning", `${mcpExposed.length} capabilit${mcpExposed.length === 1 ? "y sets" : "ies set"} expose.mcp, but the manifest does not configure agents.mcp — the exposure is recorded in the graph and nothing serves it. Add \`agents: { mcp: {} }\` to defineApp() to serve them at /mcp.`));
}
/**
* Static checks for `agents.mcp.auth` — the OAuth resource-server config.
*
* `resolveApp()` validates the same config at build time and throws, but that
* requires running the app. These checks read the manifest source, so `pracht
* verify` reports a broken `/mcp` auth setup without a Vite server. Everything
* this analyzer cannot read stays silent rather than guessing.
*/
function collectMcpAuthChecks(project, manifestPath, manifestSource, checks) {
	const agentsBody = findTopLevelObjectProperty(manifestSource, "agents");
	if (!agentsBody) return;
	if (scanTopLevelProperties(agentsBody).has("auth")) checks.push(createCheck("error", "defineApp({ agents.auth }) is not a thing. OAuth resource-server config belongs to the remote MCP endpoint: move it to `agents: { mcp: { auth: { … } } }`, which is also what enables the endpoint in the first place."));
	const mcpBody = findTopLevelObjectProperty(agentsBody, "mcp");
	if (!mcpBody) return;
	const unknownMcpKeys = collectUnknownKeys(mcpBody, MCP_CONFIG_KEYS);
	for (const key of unknownMcpKeys) checks.push(createCheck("error", `Unknown agents.mcp option ${JSON.stringify(key)}. Allowed options: ${[...MCP_CONFIG_KEYS].join(", ")}.`));
	const authBody = findTopLevelObjectProperty(mcpBody, "auth");
	if (!authBody) return;
	const authIsPartlyOpaque = /\.\.\./.test(maskCommentsAndStrings(authBody));
	let authIsProvablyValid = !authIsPartlyOpaque && unknownMcpKeys.length === 0;
	const properties = scanTopLevelProperties(authBody);
	for (const key of collectUnknownKeys(authBody, MCP_AUTH_CONFIG_KEYS)) {
		authIsProvablyValid = false;
		checks.push(createCheck("error", `Unknown agents.mcp.auth option ${JSON.stringify(key)}. Allowed options: ${[...MCP_AUTH_CONFIG_KEYS].join(", ")}.`));
	}
	const resourceExpression = properties.get("resource");
	const resource = evaluateLiteral(resourceExpression ?? "");
	if (resourceExpression === void 0 && !authIsPartlyOpaque) {
		checks.push(createCheck("error", "agents.mcp.auth is configured without a `resource` URL. It must identify the remote MCP endpoint's absolute deployed URL."));
		authIsProvablyValid = false;
	} else if (resourceExpression !== void 0 && typeof resource !== "string") authIsProvablyValid = false;
	if (typeof resource === "string") {
		let parsed = null;
		try {
			parsed = new URL(resource);
		} catch {
			parsed = null;
		}
		if (!parsed) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.resource ${JSON.stringify(resource)} is not an absolute URL. It is the token audience and the base for the metadata URL hosts discover, so it must be the endpoint's absolute https URL.`));
		} else if (!oauthUrlUsesSafeTransport(parsed)) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.resource ${JSON.stringify(resource)} must use https (http is allowed for loopback development only).`));
		} else if (parsed.search || parsed.hash) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.resource ${JSON.stringify(resource)} must not carry a query string or fragment.`));
		} else if (!oauthUrlHasCanonicalSpelling(resource, parsed, true)) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.resource ${JSON.stringify(resource)} must use its canonical URL spelling ${JSON.stringify(parsed.href)} because OAuth identifiers are matched exactly.`));
		} else if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.resource ${JSON.stringify(resource)} must not carry a trailing slash. OAuth resource identifiers are matched exactly; use the MCP endpoint's canonical path.`));
		} else {
			const mcpProperties = scanTopLevelProperties(mcpBody);
			const configuredPath = evaluateLiteral(mcpProperties.get("path") ?? "");
			if (mcpProperties.has("path") && typeof configuredPath !== "string") authIsProvablyValid = false;
			else if (typeof configuredPath === "string" && !isValidCapabilityHttpPath(configuredPath)) {
				authIsProvablyValid = false;
				checks.push(createCheck("error", "agents.mcp.path must be an exact same-origin pathname starting with \"/\"."));
			} else {
				const endpoint = (configuredPath ?? "/mcp").replace(/\/$/, "") || "/";
				if (endpoint === OAUTH_PROTECTED_RESOURCE_WELL_KNOWN) {
					authIsProvablyValid = false;
					checks.push(createCheck("error", `agents.mcp.path must not use the reserved OAuth protected-resource metadata path ${JSON.stringify(OAUTH_PROTECTED_RESOURCE_WELL_KNOWN)}.`));
				} else if (endpoint !== "/" && parsed.pathname !== endpoint) {
					authIsProvablyValid = false;
					if (!parsed.pathname.endsWith(endpoint)) checks.push(createCheck("error", `agents.mcp.auth.resource path ${JSON.stringify(parsed.pathname)} does not address the configured MCP endpoint ${JSON.stringify(endpoint)}.`));
				}
			}
		}
	}
	const authorizationServersExpression = properties.get("authorizationServers");
	const authorizationServers = evaluateLiteral(authorizationServersExpression ?? "");
	if (authorizationServersExpression === void 0) {
		authIsProvablyValid = false;
		if (!authIsPartlyOpaque) checks.push(createCheck("error", "agents.mcp.auth.authorizationServers must list at least one absolute authorization server issuer URL."));
	} else if (authorizationServersExpression !== void 0 && authorizationServers === void 0) authIsProvablyValid = false;
	else if (!Array.isArray(authorizationServers) || authorizationServers.length === 0) {
		authIsProvablyValid = false;
		checks.push(createCheck("error", "agents.mcp.auth.authorizationServers must list at least one absolute authorization server issuer URL."));
	} else for (const issuer of authorizationServers) {
		let parsed = null;
		if (typeof issuer === "string") try {
			parsed = new URL(issuer);
		} catch {
			parsed = null;
		}
		if (!parsed) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.authorizationServers contains a non-absolute issuer URL: ${JSON.stringify(issuer)}.`));
		} else if (!oauthUrlUsesSafeTransport(parsed)) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.authorizationServers issuer ${JSON.stringify(issuer)} must use https (http is allowed for loopback development only).`));
		} else if (parsed.search || parsed.hash) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.authorizationServers issuer ${JSON.stringify(issuer)} must not carry a query string or fragment.`));
		} else if (!oauthUrlHasCanonicalSpelling(issuer, parsed, true)) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.authorizationServers issuer ${JSON.stringify(issuer)} must use its canonical URL spelling ${JSON.stringify(parsed.href)} because OAuth identifiers are matched exactly.`));
		}
	}
	const resourceDocumentationExpression = properties.get("resourceDocumentation");
	if (resourceDocumentationExpression !== void 0) {
		const resourceDocumentation = evaluateLiteral(resourceDocumentationExpression);
		if (typeof resourceDocumentation !== "string") authIsProvablyValid = false;
		else {
			let parsed = null;
			try {
				parsed = new URL(resourceDocumentation);
			} catch {
				parsed = null;
			}
			if (!parsed) {
				authIsProvablyValid = false;
				checks.push(createCheck("error", `agents.mcp.auth.resourceDocumentation ${JSON.stringify(resourceDocumentation)} is not an absolute URL.`));
			} else if (!oauthUrlUsesSafeTransport(parsed)) {
				authIsProvablyValid = false;
				checks.push(createCheck("error", `agents.mcp.auth.resourceDocumentation ${JSON.stringify(resourceDocumentation)} must use https (http is allowed for loopback development only).`));
			}
		}
	}
	for (const field of ["scopesSupported", "requiredScopes"]) {
		const expression = properties.get(field);
		if (expression === void 0) continue;
		const scopes = evaluateLiteral(expression);
		if (scopes === void 0) authIsProvablyValid = false;
		else if (!Array.isArray(scopes) || scopes.some((scope) => !isValidOAuthScopeToken(scope))) {
			authIsProvablyValid = false;
			checks.push(createCheck("error", `agents.mcp.auth.${field} must be an array of OAuth scope tokens using printable ASCII except quotes and backslashes.`));
		}
	}
	const verifyExpression = findProvableTopLevelProperty(authBody, "verify");
	if (verifyExpression === void 0) {
		if (!authIsPartlyOpaque) checks.push(createCheck("error", "agents.mcp.auth is configured without a `verify` module. The endpoint would advertise authentication it never performs — add `verify: () => import(\"./server/mcp-token.ts\")` whose default export verifies a bearer token."));
		return;
	}
	const verifyPath = extractMcpVerifyModulePath(verifyExpression);
	if (!verifyPath) {
		checks.push(createCheck("error", "agents.mcp.auth.verify must be a module reference such as `verify: () => import(\"./server/mcp-token.ts\")`."));
		return;
	}
	const filePath = verifyPath.startsWith("/") ? resolveProjectPath(project.root, verifyPath) : resolve(dirname(manifestPath), verifyPath);
	if (!existsSync(filePath)) {
		checks.push(createCheck("error", `agents.mcp.auth.verify references missing file ${JSON.stringify(verifyPath)}.`));
		return;
	}
	if (!statSync(filePath).isFile()) {
		checks.push(createCheck("error", `agents.mcp.auth.verify references ${JSON.stringify(verifyPath)}, which is not a file.`));
		return;
	}
	const registryDirs = [
		project.serverDir,
		project.middlewareDir,
		project.capabilitiesDir
	];
	if (!registryDirs.some((dir) => isInsideDirectory(project.root, dir, filePath))) {
		checks.push(createCheck("error", `agents.mcp.auth.verify module ${JSON.stringify(verifyPath)} is outside the directories the build registers (${registryDirs.join(", ")}), so the runtime can never load it and every /mcp request would answer 401. Move it to ${project.serverDir}/.`));
		return;
	}
	const verifierExport = inspectDefaultFunctionExport(readFileSync(filePath, "utf-8"));
	if (verifierExport === "invalid") {
		checks.push(createCheck("error", `agents.mcp.auth.verify module ${JSON.stringify(verifyPath)} must default-export a token verifier function.`));
		return;
	}
	if (verifierExport === "unknown") {
		authIsProvablyValid = false;
		checks.push(createCheck("warning", `Could not prove that agents.mcp.auth.verify module ${JSON.stringify(verifyPath)} default-exports a function. Use a direct \`export default function\` or \`export default (...) => ...\` declaration so verification can confirm the endpoint will load it.`));
	}
	if (authIsProvablyValid) checks.push(createCheck("ok", "Remote MCP endpoint is an OAuth 2.0 protected resource (RFC 9728)."));
}
function collectUnknownKeys(body, allowed) {
	return [...scanTopLevelProperties(body).keys()].filter((key) => !allowed.has(key));
}
/** Prove the runtime's `module.default` callable contract without executing user code. */
function inspectDefaultFunctionExport(source) {
	const masked = maskCommentsAndStrings(source);
	if (/\bexport\s+default\s+(?:async\s+)?function\b/.test(masked)) return "valid";
	if (/\bexport\s+default\s+(?:async\s+)?(?:\([^;{}]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(masked)) return "valid";
	const identifier = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(masked)?.[1];
	if (identifier) {
		const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (new RegExp(`\\b(?:async\\s+)?function\\s+${escaped}\\b`).test(masked)) return "valid";
		if (new RegExp(`\\b(?:const|let|var)\\s+${escaped}(?:\\s*:[^=;]+)?\\s*=\\s*(?:async\\s+)?(?:function\\b|(?:\\([^;{}]*\\)|[A-Za-z_$][\\w$]*)\\s*=>)`).test(masked)) return "valid";
		const initializer = new RegExp(`\\b(?:const|let|var)\\s+${escaped}(?:\\s*:[^=;]+)?\\s*=\\s*([^;]+)`).exec(masked)?.[1];
		if (initializer !== void 0 && isProvablyNonFunctionInitializer(initializer)) return "invalid";
		return "unknown";
	}
	if (/\bexport\s*\{[^}]*\bdefault\b[^}]*\}/.test(masked)) return "unknown";
	return "invalid";
}
function isProvablyNonFunctionInitializer(initializer) {
	const value = initializer.trim();
	return value.startsWith("{") || value.startsWith("[") || /^(?:null|true|false|[-+]?\d|["'`])/.test(value);
}
/** A statically provable ModuleRef shape that the manifest transform supports. */
function extractMcpVerifyModulePath(expression) {
	const literal = evaluateLiteral(expression);
	if (typeof literal === "string" && literal !== "") return literal;
	return /^\s*\(\)\s*=>\s*import\(\s*(["'])([^"']+)\1\s*\)\s*$/.exec(expression)?.[2] ?? null;
}
/**
* Read an explicit top-level property even when an earlier spread truncated the
* shared scanner. A later spread resets the proof because it may override the
* value; a later explicit property makes the value knowable again.
*/
function findProvableTopLevelProperty(objectBody, key) {
	const searchable = maskCommentsAndStrings(objectBody);
	const entries = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index <= searchable.length; index += 1) {
		const character = searchable[index];
		if (character === "{" || character === "[" || character === "(") depth += 1;
		else if (character === "}" || character === "]" || character === ")") depth -= 1;
		if (character === "," && depth === 0 || index === searchable.length) {
			entries.push(objectBody.slice(start, index));
			start = index + 1;
		}
	}
	let expression;
	for (const entry of entries) {
		if (maskCommentsAndStrings(entry).trimStart().startsWith("...")) {
			expression = void 0;
			continue;
		}
		const candidate = scanTopLevelProperties(entry).get(key);
		if (candidate !== void 0) expression = candidate;
	}
	return expression;
}
function oauthUrlUsesSafeTransport(url) {
	return url.protocol === "https:" || url.protocol === "http:" && isLoopbackHost(url.hostname);
}
function oauthUrlHasCanonicalSpelling(value, url, allowRootWithoutSlash) {
	return url.href === value || allowRootWithoutSlash && url.pathname === "/" && url.search === "" && url.hash === "" && url.href === `${value}/`;
}
function isLoopbackHost(hostname) {
	if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]") return true;
	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
	return !!ipv4 && Number(ipv4[1]) === 127 && ipv4.slice(1).every((part) => Number(part) <= 255);
}
/** Whether an absolute file path sits inside a project-relative directory. */
function isInsideDirectory(root, dir, filePath) {
	const relative$1 = relative(resolveProjectPath(root, dir), filePath);
	return relative$1 !== "" && !relative$1.startsWith("..") && !isAbsolute(relative$1);
}
/**
* The generated browser client turns dotted names into nested objects, so
* `notes.search` becomes `capabilities.notes.search`. A name that is also a
* prefix of another (`notes` alongside `notes.search`) cannot be both a
* function and a namespace: the namespace wins and the shorter name is only
* reachable through `callCapability()`. Warn rather than error — the capability
* still works over HTTP and through every other projection.
*/
function collectShadowedNameChecks(names, checks) {
	for (const name of names) {
		const shadowedBy = names.filter((other) => other.startsWith(`${name}.`));
		if (shadowedBy.length > 0) checks.push(createCheck("warning", `Capability ${JSON.stringify(name)} is also a namespace for ${shadowedBy.map((other) => JSON.stringify(other)).join(", ")}, so it is not reachable on the generated capabilities client. Call it via callCapability() or rename it.`));
	}
}
/**
* The nested client contains only endpoints that the build can prove are
* HTTP-exposed. Private, WebMCP-only, and invalid or dynamic exposure entries
* cannot create a runtime namespace collision and must not trigger the warning.
*/
function hasValidStaticHttpExposure(source) {
	const args = extractDefineCapabilityArgs(source);
	if (!args) return false;
	const exposeFlags = readExposeFlags(scanTopLevelProperties(args).get("expose"));
	return exposeFlags.hasHttp && !exposeFlags.unknown && exposeFlags.problems.length === 0;
}
function collectSingleCapabilityChecks(name, displayPath, source, registeredMiddleware, checks, graph) {
	const { mcpExposed, destructiveMcpExposed, projection, appAgentPolicy } = graph;
	const label = `Capability ${JSON.stringify(name)} (${displayPath})`;
	const args = extractDefineCapabilityArgs(source);
	if (!args) {
		checks.push(createCheck("error", `${label} does not contain a statically analyzable defineCapability({ ... }) call.`));
		return;
	}
	const { properties, truncated } = scanTopLevelPropertyEntries(args);
	const title = readStaticString(properties.get("title"));
	const description = readStaticString(properties.get("description"));
	const effect = readStaticString(properties.get("effect"));
	const problems = [];
	const missing = [];
	if (title.kind === "absent") missing.push("title");
	if (description.kind === "absent") missing.push("description");
	if (!properties.has("input")) missing.push("input schema");
	if (!properties.has("output")) missing.push("output schema");
	if (effect.kind === "absent") missing.push("effect");
	if (missing.length > 0) problems.push(`is missing required fields: ${missing.join(", ")}`);
	const exposeFlags = readExposeFlags(properties.get("expose"));
	const exposed = exposeFlags.hasHttp || exposeFlags.hasMcp || exposeFlags.hasWebmcp;
	const hasMcp = !exposeFlags.unknown && exposeFlags.hasMcp;
	problems.push(...exposeFlags.problems);
	for (const [field, value] of [["title", title], ["description", description]]) if (value.kind === "invalid") problems.push(`"${field}" must be a non-empty string`);
	else if (value.kind === "unknown") checks.push(createCheck("warning", `${label}: the "${field}" field is not an inline string literal, so it could not be verified statically.`));
	if (effect.kind === "invalid") problems.push("\"effect\" must be a non-empty string");
	else if (effect.kind === "unknown") if (!exposeFlags.unknown && exposeFlags.hasHttp) problems.push("\"effect\" must be an inline \"read\", \"write\", or \"destructive\" string literal for HTTP exposure");
	else checks.push(createCheck("warning", `${label}: the "effect" field is not an inline string literal, so it could not be verified statically.`));
	const effectValue = effect.kind === "valid" ? effect.value : null;
	if (effectValue && !CAPABILITY_EFFECTS.has(effectValue)) problems.push("\"effect\" must be \"read\", \"write\", or \"destructive\"");
	const agentPolicy = readStaticString(properties.get("agentPolicy"));
	if (properties.has("agentPolicy")) {
		if (agentPolicy.kind === "unknown") checks.push(createCheck("warning", `${label}: the "agentPolicy" field is not an inline string literal, so it could not be verified statically.`));
		else if (agentPolicy.kind !== "valid" || !AGENT_POLICIES.has(agentPolicy.value)) problems.push("\"agentPolicy\" must be \"observe\" or \"require\"");
	}
	const middleware = readMiddlewareNames(properties.get("middleware"));
	if (middleware.kind === "invalid") problems.push("\"middleware\" must be an array of names");
	else if (middleware.kind === "unknown") checks.push(createCheck("warning", `${label}: the "middleware" field is not an inline array literal, so it could not be verified statically.`));
	else if (middleware.kind === "valid") {
		for (const middlewareName of middleware.names) if (!registeredMiddleware.has(middlewareName)) problems.push(`references unknown middleware ${JSON.stringify(middlewareName)}`);
	}
	if (exposeFlags.unknown) checks.push(createCheck("warning", `${label}: the "expose" field is not an inline object literal, so its exposure contract could not be verified statically — including the destructive-exposure and confirmation-secret checks. Inline the expose object so verification can cover it.`));
	if (exposed && !exposeFlags.unknown) {
		const { hasHttp, hasWebmcp } = exposeFlags;
		if (hasMcp) {
			mcpExposed.push(name);
			if (!isValidMcpToolName(mcpToolName(name))) problems.push(MCP_TOOL_NAME_ERROR);
		}
		if (hasWebmcp && !hasHttp) problems.push("sets expose.webmcp without expose.http — WebMCP tools dispatch through the HTTP projection");
		if (hasWebmcp) {
			if (!isValidWebmcpToolName(name)) problems.push(WEBMCP_TOOL_NAME_ERROR);
			if ((agentPolicy.kind === "valid" ? agentPolicy.value : agentPolicy.kind === "absent" && !truncated ? appAgentPolicy : void 0) === "require") checks.push(createCheck("warning", `${label} is exposed as a WebMCP page tool under agentPolicy "require"${agentPolicy.kind === "absent" ? " (inherited from agents.webBotAuth.policy)" : ""}. WebMCP calls are unsigned browser fetches, so every call from the page tool will be rejected with a 401. Override with agentPolicy: "observe" on the capability, or drop expose.webmcp.`));
			collectWebmcpBudgetChecks(label, description, properties.get("input"), checks);
		}
		if (effectValue === "destructive") {
			if (hasMcp) destructiveMcpExposed.push(name);
			if (hasWebmcp) problems.push("is destructive and exposed as a WebMCP page tool — a browser host's approval UX is not a security boundary. Use expose.http, or expose.mcp with agents.mcp.destructive, both gated by the prepare/commit confirmation flow");
			else if ((hasHttp || hasMcp && projection.destructive) && !process.env.PRACHT_CONFIRMATION_SECRET) problems.push("is destructive and exposed without PRACHT_CONFIRMATION_SECRET in the environment — the prepare/commit confirmation flow needs the secret and the runtime fails closed without it. Verification reads the real environment, not `.env`: `pracht dev` loads that file, but a deployed server takes its environment from the platform, so set a real variable (or a Cloudflare secret / Vercel environment variable) there");
		}
	}
	const invalidMcpSchemaRoots = [];
	for (const field of ["input", "output"]) {
		const schemaText = properties.get(field);
		if (!schemaText) continue;
		const schema = evaluateLiteral(schemaText);
		if (schema === void 0) {
			checks.push(createCheck("warning", `${label}: the "${field}" schema is not an inline object literal, so its JSON Schema subset could not be verified statically.`));
			continue;
		}
		if (hasMcp && (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object")) invalidMcpSchemaRoots.push(field);
		const unsupported = collectUnsupportedSchemaKeywords(schema);
		if (unsupported.length > 0) problems.push(`"${field}" schema uses unsupported JSON Schema keywords: ${unsupported.join(", ")}`);
		const invalid = collectInvalidSchemaKeywordValues(schema);
		if (invalid.length > 0) problems.push(`"${field}" schema has invalid JSON Schema values: ${invalid.join(", ")}`);
	}
	if (invalidMcpSchemaRoots.length > 0) problems.push(`${MCP_SCHEMA_ROOT_ERROR} (invalid: ${invalidMcpSchemaRoots.join(", ")})`);
	if (problems.length > 0) {
		for (const problem of problems) checks.push(createCheck("error", `${label} ${problem}.`));
		return;
	}
	if (exposeFlags.unknown) return;
	checks.push(createCheck("ok", `${label} declares a complete ${exposed ? "exposed" : "private"} contract${effectValue ? ` (effect: ${effectValue})` : ""}.`));
}
/**
* Chrome's published WebMCP authoring budgets: agents read tool metadata on
* every page, so oversized prose degrades tool selection long before any hard
* limit. Advisory — warnings, not errors.
*/
const WEBMCP_DESCRIPTION_BUDGET = 500;
const WEBMCP_PARAM_DESCRIPTION_BUDGET = 150;
function collectWebmcpBudgetChecks(label, description, inputText, checks) {
	if (description.kind === "valid" && description.value.length > WEBMCP_DESCRIPTION_BUDGET) checks.push(createCheck("warning", `${label} is exposed as a WebMCP page tool with a ${description.value.length}-character description — in-browser agents work best under ~${WEBMCP_DESCRIPTION_BUDGET} characters.`));
	const schema = inputText ? evaluateLiteral(inputText) : void 0;
	if (!schema || typeof schema !== "object") return;
	for (const [path, text] of collectSchemaDescriptions(schema, "")) if (text.length > WEBMCP_PARAM_DESCRIPTION_BUDGET) checks.push(createCheck("warning", `${label} is exposed as a WebMCP page tool and its input schema description at ${JSON.stringify(path)} is ${text.length} characters — in-browser agents work best under ~${WEBMCP_PARAM_DESCRIPTION_BUDGET} characters per parameter.`));
}
/** Every `description` string in a JSON Schema subtree, except the root's (that is the tool description's job). */
function collectSchemaDescriptions(schema, path) {
	const found = [];
	if (path !== "" && typeof schema.description === "string") found.push([path, schema.description]);
	const properties = schema.properties;
	if (properties && typeof properties === "object" && !Array.isArray(properties)) {
		for (const [key, value] of Object.entries(properties)) if (value && typeof value === "object" && !Array.isArray(value)) found.push(...collectSchemaDescriptions(value, path === "" ? key : `${path}.${key}`));
	}
	const items = schema.items;
	if (items && typeof items === "object" && !Array.isArray(items)) found.push(...collectSchemaDescriptions(items, path === "" ? "[]" : `${path}[]`));
	return found;
}
function readAppAgentPolicyDefault(manifestSource) {
	const appBody = extractDefineAppObjectBody(manifestSource);
	if (appBody === null) return void 0;
	const agentsText = readScannedProperty(appBody, "agents");
	if (agentsText === null) return null;
	if (agentsText === void 0) return void 0;
	const agentsBody = readInlineObjectBody(agentsText);
	if (agentsBody === null) return void 0;
	const webBotAuthText = readScannedProperty(agentsBody, "webBotAuth");
	if (webBotAuthText === null) return null;
	if (webBotAuthText === void 0) return void 0;
	const webBotAuthBody = readInlineObjectBody(webBotAuthText);
	if (webBotAuthBody === null) return void 0;
	const policyText = readScannedProperty(webBotAuthBody, "policy");
	if (policyText === null) return null;
	if (policyText === void 0) return void 0;
	const value = evaluateLiteral(policyText);
	return typeof value === "string" ? value : void 0;
}
/**
* One property from a scanned object body: its text when present, `null` when
* provably absent, `undefined` when the scan was truncated before it could
* decide (a spread or computed key hides everything after it).
*/
function readScannedProperty(objectBody, key) {
	const { properties, truncated } = scanTopLevelPropertyEntries(objectBody);
	const text = properties.get(key);
	if (text !== void 0) return text;
	return truncated ? void 0 : null;
}
function readStaticString(text) {
	if (!text) return { kind: "absent" };
	const value = evaluateLiteral(text);
	if (value === void 0) return { kind: "unknown" };
	if (typeof value !== "string" || value.trim() === "") return { kind: "invalid" };
	return {
		kind: "valid",
		value
	};
}
function readMiddlewareNames(text) {
	if (!text) return { kind: "absent" };
	const value = evaluateLiteral(text);
	if (value === void 0) return { kind: "unknown" };
	if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) return { kind: "invalid" };
	return {
		kind: "valid",
		names: value
	};
}
function readExposeFlags(text) {
	if (text === void 0) return {
		hasHttp: false,
		hasMcp: false,
		hasWebmcp: false,
		unknown: false,
		problems: []
	};
	const value = evaluateLiteral(text);
	if (value === void 0) return {
		hasHttp: false,
		hasMcp: false,
		hasWebmcp: false,
		unknown: true,
		problems: []
	};
	if (!value || typeof value !== "object" || Array.isArray(value)) return {
		hasHttp: false,
		hasMcp: false,
		hasWebmcp: false,
		unknown: false,
		problems: ["\"expose\" must be an inline object literal"]
	};
	const expose = value;
	const problems = [];
	let hasHttp = false;
	if (expose.http === true) hasHttp = true;
	else if (expose.http && typeof expose.http === "object" && !Array.isArray(expose.http)) {
		hasHttp = true;
		const http = expose.http;
		if (http.method !== void 0 && http.method !== "POST") problems.push("HTTP exposure only supports method: \"POST\"");
		if (http.path !== void 0 && !isValidCapabilityHttpPath(http.path)) problems.push("HTTP exposure \"path\" must be an exact same-origin pathname starting with \"/\"");
	} else if (expose.http !== void 0 && expose.http !== false && expose.http !== null) problems.push("\"expose.http\" must be true or an object");
	let hasWebmcp = false;
	if (expose.webmcp === true) hasWebmcp = true;
	else if (expose.webmcp && typeof expose.webmcp === "object" && !Array.isArray(expose.webmcp)) {
		hasWebmcp = true;
		const webmcp = expose.webmcp;
		if (webmcp.untrustedContent !== void 0 && typeof webmcp.untrustedContent !== "boolean") problems.push("WebMCP exposure \"untrustedContent\" must be a boolean");
	} else if (expose.webmcp !== void 0 && expose.webmcp !== false && expose.webmcp !== null) problems.push("\"expose.webmcp\" must be true or an options object");
	return {
		hasHttp,
		hasMcp: expose.mcp === true,
		hasWebmcp,
		unknown: false,
		problems
	};
}
//#endregion
//#region src/verification-env.ts
const VITE_BUILTIN_ENV_VARS = new Set([
	"MODE",
	"DEV",
	"PROD",
	"SSR",
	"BASE_URL",
	"NODE_ENV"
]);
const PUBLIC_ENV_PREFIX = "PRACHT_PUBLIC_";
const ENV_REFERENCE_RE = /\b(process\.env|import\.meta\.env)(?:\??\.([A-Za-z_$][A-Za-z0-9_$]*)|(?:\?\.)?\[\s*(["'])([A-Za-z_$][A-Za-z0-9_$]*)\3\s*\])/g;
const WHOLE_ENV_READ_RE = /\bimport\.meta\.env\b(?!\s*\??\.\s*[A-Za-z_$])/g;
const WHOLE_ENV_READ = "*";
function scanSourceForEnvLeaks(code, allow) {
	const codePositions = getCodePositionMask(code);
	const matches = [];
	for (const match of code.matchAll(ENV_REFERENCE_RE)) {
		const index = match.index ?? -1;
		if (!codePositions[index]) continue;
		const accessor = match[1];
		const name = match[2] ?? match[4];
		if (!name) continue;
		if (name.startsWith(PUBLIC_ENV_PREFIX)) continue;
		if (VITE_BUILTIN_ENV_VARS.has(name)) continue;
		if (allow.has(name)) continue;
		matches.push({
			accessor,
			index,
			name
		});
	}
	if (!allow.has(WHOLE_ENV_READ)) for (const match of code.matchAll(WHOLE_ENV_READ_RE)) {
		const index = match.index ?? -1;
		if (!codePositions[index]) continue;
		matches.push({
			accessor: "import.meta.env",
			index,
			name: WHOLE_ENV_READ
		});
	}
	const findings = [];
	const seen = /* @__PURE__ */ new Set();
	for (const { accessor, name } of matches.sort((a, b) => a.index - b.index)) {
		const key = `${accessor}.${name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		findings.push({
			accessor,
			name
		});
	}
	return findings;
}
function getCodePositionMask(code) {
	const mask = new Uint8Array(code.length);
	const templateExpressionDepths = [];
	let mode = "code";
	let regexCharClass = false;
	let i = 0;
	while (i < code.length) {
		const char = code[i];
		const next = code[i + 1];
		if (mode === "line-comment") {
			if (char === "\n" || char === "\r") {
				mode = "code";
				mask[i] = 1;
			}
			i++;
			continue;
		}
		if (mode === "block-comment") {
			if (char === "*" && next === "/") {
				mode = "code";
				i += 2;
			} else i++;
			continue;
		}
		if (mode === "single" || mode === "double") {
			const quote = mode === "single" ? "'" : "\"";
			if (char === "\\") {
				i += 2;
				continue;
			}
			if (char === quote || char === "\n" || char === "\r") mode = "code";
			i++;
			continue;
		}
		if (mode === "regex") {
			if (char === "\\") {
				i += 2;
				continue;
			}
			if (char === "[") {
				regexCharClass = true;
				i++;
				continue;
			}
			if (char === "]") {
				regexCharClass = false;
				i++;
				continue;
			}
			if (char === "/" && !regexCharClass) {
				regexCharClass = false;
				i++;
				while (i < code.length && isIdentifierChar(code[i])) i++;
				mode = "code";
				continue;
			}
			if (char === "\n" || char === "\r") {
				regexCharClass = false;
				mode = "code";
			}
			i++;
			continue;
		}
		if (mode === "template") {
			if (char === "\\") {
				i += 2;
				continue;
			}
			if (char === "`") {
				mode = "code";
				i++;
				continue;
			}
			if (char === "$" && next === "{") {
				mask[i] = 1;
				mask[i + 1] = 1;
				templateExpressionDepths.push(1);
				mode = "code";
				i += 2;
				continue;
			}
			i++;
			continue;
		}
		mask[i] = 1;
		if (char === "/" && next === "/") {
			mask[i + 1] = 1;
			mode = "line-comment";
			i += 2;
			continue;
		}
		if (char === "/" && next === "*") {
			mask[i + 1] = 1;
			mode = "block-comment";
			i += 2;
			continue;
		}
		if (char === "/" && isRegexLiteralStart(code, i)) {
			mode = "regex";
			regexCharClass = false;
			i++;
			continue;
		}
		if (char === "'") {
			mode = "single";
			i++;
			continue;
		}
		if (char === "\"") {
			mode = "double";
			i++;
			continue;
		}
		if (char === "`") {
			mode = "template";
			i++;
			continue;
		}
		if (templateExpressionDepths.length > 0) {
			const top = templateExpressionDepths.length - 1;
			if (char === "{") templateExpressionDepths[top]++;
			else if (char === "}") {
				templateExpressionDepths[top]--;
				if (templateExpressionDepths[top] === 0) {
					templateExpressionDepths.pop();
					mode = "template";
				}
			}
		}
		i++;
	}
	return mask;
}
function isRegexLiteralStart(code, slashIndex) {
	let i = slashIndex - 1;
	while (i >= 0 && /\s/.test(code[i])) i--;
	if (i < 0) return true;
	const previous = code[i];
	if (previous === ">" && code[i - 1] === "=") return true;
	if ("([{=,:;!?&|^~<>*%+-".includes(previous)) return true;
	if (isIdentifierChar(previous)) {
		let start = i;
		while (start >= 0 && isIdentifierChar(code[start])) start--;
		const word = code.slice(start + 1, i + 1);
		return new Set([
			"await",
			"case",
			"delete",
			"do",
			"else",
			"in",
			"instanceof",
			"new",
			"of",
			"return",
			"throw",
			"typeof",
			"void",
			"yield"
		]).has(word);
	}
	return false;
}
function isIdentifierChar(char) {
	return !!char && /[A-Za-z0-9_$]/.test(char);
}
/**
* Best-effort extraction of `envSafety: { allow: [...] }` names from the raw
* vite config source, so verify matches the build-time allowlist.
*/
function extractEnvSafetyAllowList(rawConfig) {
	const allow = /* @__PURE__ */ new Set();
	const codePositions = getCodePositionMask(rawConfig);
	const envSafetyMatch = Array.from(rawConfig.matchAll(/envSafety\s*:\s*\{[^}]*allow\s*:\s*\[([^\]]*)\]/g)).find((match) => codePositions[match.index ?? -1]);
	if (!envSafetyMatch) return allow;
	for (const entry of envSafetyMatch[1].matchAll(/["']([^"']+)["']/g)) allow.add(entry[1]);
	return allow;
}
function envSafetyDisabled(rawConfig) {
	const codePositions = getCodePositionMask(rawConfig);
	return Array.from(rawConfig.matchAll(/envSafety\s*:\s*false/g)).some((match) => codePositions[match.index ?? -1]);
}
function readBuildEnvSafetyReport(clientDir) {
	const reportPath = join(clientDir, "_pracht/env-safety.json");
	if (!existsSync(reportPath)) return null;
	let report;
	try {
		report = JSON.parse(readFileSync(reportPath, "utf-8"));
	} catch {
		return null;
	}
	return (report.findings ?? []).filter((finding) => typeof finding.accessor === "string" && typeof finding.chunk === "string" && typeof finding.name === "string").map((finding) => ({
		accessor: finding.accessor,
		file: finding.chunk,
		name: finding.name
	}));
}
function collectEnvLeakVerification(project, checks, { scope }) {
	if (scope !== "full") return;
	if (envSafetyDisabled(project.rawConfig)) {
		checks.push(createCheck("warning", "Client-bundle env leak detection is disabled (envSafety: false)."));
		return;
	}
	const clientDir = resolve(project.root, "dist/client");
	if (!existsSync(clientDir)) {
		checks.push(createCheck("ok", "No client build output at dist/client; run `pracht build` to verify env leaks."));
		return;
	}
	const allow = extractEnvSafetyAllowList(project.rawConfig);
	const buildReportFindings = readBuildEnvSafetyReport(clientDir);
	const findings = buildReportFindings ?? [];
	for (const file of listFilesRecursively(clientDir)) {
		if (!file.endsWith(".js") && !file.endsWith(".mjs")) continue;
		const code = readFileSync(file, "utf-8");
		for (const finding of scanSourceForEnvLeaks(code, allow)) findings.push({
			...finding,
			file: displayPath(project.root, file)
		});
	}
	if (findings.length > 0) checks.push(createCheck("error", `Client bundle references non-public env vars: ${findings.map((finding) => {
		return `${finding.name === WHOLE_ENV_READ ? "import.meta.env read as a whole object" : `${finding.accessor}.${finding.name}`} in ${JSON.stringify(finding.file)}`;
	}).join("; ")}. Only PRACHT_PUBLIC_-prefixed variables are safe client-side.`));
	else if (!buildReportFindings) checks.push(createCheck("warning", "No env safety build report found at dist/client/_pracht/env-safety.json; output scan passed, but rebuild with the current Pracht plugin to verify source-level env references."));
	else checks.push(createCheck("ok", "Client bundle contains no non-public env var references."));
}
//#endregion
//#region src/verification-static.ts
function list(paths) {
	return paths.join(", ");
}
function collectStaticExportChecks(graph, checks, options) {
	if (!options.staticTarget) return;
	const routes = graph.routes ?? [];
	let problems = 0;
	const serverRendered = routes.filter((route) => route.render !== "ssg" && route.render !== "spa");
	if (serverRendered.length > 0) {
		problems += 1;
		checks.push(createCheck("error", `Static export: these routes render on a server at request time, but a static export has no server: ${list(serverRendered.map((route) => `${route.path} (render: "${route.render ?? "ssr"}")`))}. Use @pracht/adapter-node, @pracht/adapter-cloudflare, or @pracht/adapter-vercel instead, or change the route to render: "ssg" (or loaderless "spa" for client-only pages).`));
	}
	const spaWithLoaders = routes.filter((route) => {
		if (route.render !== "spa") return false;
		return options.loaderRoutePaths ? options.loaderRoutePaths.has(route.path) : route.loaderFile !== null;
	});
	if (spaWithLoaders.length > 0) {
		problems += 1;
		checks.push(createCheck("error", `Static export: these SPA routes declare server loaders, but a static host cannot run them at request time: ${list(spaWithLoaders.map((route) => route.path))}. Static SPA routes must be loaderless. Fetch live data from the browser, change the route to SSG for build-time data, or use a serverful adapter.`));
	}
	const spaWithNonFullHydration = routes.filter((route) => route.render === "spa" && route.hydration !== null && route.hydration !== "full");
	if (spaWithNonFullHydration.length > 0) {
		problems += 1;
		checks.push(createCheck("error", `Static export: these SPA routes use non-full hydration, but SPA components render entirely in the browser: ${list(spaWithNonFullHydration.map((route) => `${route.path} (hydration: "${route.hydration}")`))}. Remove the hydration option (or set it to "full"), change the route to SSG, or use a serverful adapter.`));
	}
	const routesWithMiddleware = routes.filter((route) => route.middleware.length > 0);
	if (routesWithMiddleware.length > 0) {
		problems += 1;
		checks.push(createCheck("error", `Static export: these routes use request middleware, but a static host has no request runtime to enforce it: ${list(routesWithMiddleware.map((route) => route.path))}. Remove the route middleware or use a serverful adapter.`));
	}
	const apiRoutes = graph.api ?? [];
	if (apiRoutes.length > 0) {
		problems += 1;
		checks.push(createCheck("error", `Static export: API routes need a server to answer requests, but a static export has none: ${list(apiRoutes.map((route) => route.path))}. Remove them or use a serverful adapter.`));
	}
	const exposedCapabilities = (graph.capabilities ?? []).filter((capability) => capability.transports.length > 0);
	if (exposedCapabilities.length > 0) {
		problems += 1;
		checks.push(createCheck("error", `Static export: these capabilities are exposed over the network, but a static export has no server to serve them: ${list(exposedCapabilities.map((capability) => `${capability.name} (${capability.transports.join(", ")})`))}. Server-only capabilities invoked from build-time loaders are fine.`));
	}
	if (graph.mcpEndpoint) {
		problems += 1;
		checks.push(createCheck("error", `Static export: the remote MCP endpoint ${graph.mcpEndpoint} needs a server to answer requests, but a static export has none. Remove agents.mcp or use a serverful adapter.`));
	}
	if (problems === 0) checks.push(createCheck("ok", "Static export preconditions hold (no request-runtime features in use)."));
}
//#endregion
//#region src/verification-graph.ts
const HEAD_EXPORT_RE = /export\s+(?:async\s+)?(?:function|const|let|var)\s+head\b|export\s*\{[^}]*\bhead\b[^}]*\}/;
/**
* Graph-aware verification: prove registered API and capability modules load,
* enforce `defineApp({ constraints })`, and check `.pracht/app-graph.json`
* freshness. These need the resolved app graph, so the comparatively expensive
* Vite boot only happens when an app has a live surface to inspect.
*/
async function collectGraphChecks(project, checks) {
	const wantsConstraints = manifestDeclaresConstraints(project);
	const wantsCapabilityLoad = manifestDeclaresCapabilities(project);
	const wantsAgentValidation = manifestDeclaresAgents(project);
	const wantsApiLoad = projectDeclaresApiRoutes(project);
	const snapshotExists = existsSync(resolve(project.root, GRAPH_SNAPSHOT_PATH));
	const mightUseStaticExport = projectMightUseStaticExport(project);
	if (!wantsConstraints && !wantsCapabilityLoad && !wantsAgentValidation && !wantsApiLoad && !snapshotExists && !mightUseStaticExport) return;
	let live;
	let staticTarget = false;
	let loaderRoutePaths = /* @__PURE__ */ new Set();
	try {
		const metadata = await resolveLiveGraphMetadata(project.root);
		live = metadata.graph;
		staticTarget = metadata.staticTarget;
		loaderRoutePaths = metadata.loaderRoutePaths;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		checks.push(createCheck("error", `Could not resolve the app graph for live verification checks: ${message}`));
		return;
	}
	if (!wantsConstraints && !wantsCapabilityLoad && !wantsAgentValidation && !wantsApiLoad && !snapshotExists && !staticTarget) return;
	if (wantsCapabilityLoad) checks.push(createCheck("ok", `Loaded ${live.capabilities.length} registered capability module${live.capabilities.length === 1 ? "" : "s"} into the app graph.`));
	if (wantsApiLoad) checks.push(createCheck("ok", `Loaded ${live.api.length} discovered API route module${live.api.length === 1 ? "" : "s"} into the app graph.`));
	collectMcpRouteCollisionChecks(live, checks);
	collectStaticExportChecks(live, checks, {
		loaderRoutePaths,
		staticTarget
	});
	collectConstraintChecks(project, live, checks);
	collectSnapshotChecks(project, live, checks, snapshotExists);
}
/** Explicit API dispatch must not shadow the remote MCP security boundary. */
function collectMcpRouteCollisionChecks(live, checks) {
	if (live.mcpEndpoint === null) return;
	const endpoint = normalizeEndpointPath(live.mcpEndpoint);
	const collisions = live.api.filter((route) => matchRoutePath(normalizeEndpointPath(route.path), endpoint) !== null);
	for (const route of collisions) checks.push(createCheck("error", `API route ${JSON.stringify(route.path)} collides with agents.mcp.path. Move one of them; an API route must not shadow the remote MCP endpoint's transport and authentication gates.`));
}
function normalizeEndpointPath(path) {
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
function projectMightUseStaticExport(project) {
	const detectedTarget = detectAdapterTarget(project);
	if (detectedTarget === "static") return true;
	const maskedConfig = maskCommentsAndStrings(project.rawConfig);
	if (/\bstaticTarget\s*:\s*true\b/.test(maskedConfig)) return true;
	if (localConfigImportMightBeStatic(project)) return true;
	try {
		const packageJson = JSON.parse(readFileSync(resolve(project.root, "package.json"), "utf-8"));
		if ("@pracht/adapter-static" in (packageJson.dependencies ?? {}) || "@pracht/adapter-static" in (packageJson.devDependencies ?? {})) return true;
	} catch {}
	const configuresAdapter = /\badapter\s*(?::|(?=\s*[,}]))/.test(maskedConfig) || /["']adapter["']\s*:/.test(project.rawConfig);
	const isKnownNodeAdapter = /\badapter\s*:\s*nodeAdapter\s*\(/.test(maskedConfig);
	return detectedTarget === "node" && configuresAdapter && !isKnownNodeAdapter;
}
function localConfigImportMightBeStatic(project) {
	if (!project.configFile) return false;
	const importSpecifiers = [...project.rawConfig.matchAll(/^\s*import\s+(?:[^"']+?\s+from\s+)?["'](\.[^"']+)["']/gm)].map((match) => match[1]);
	for (const specifier of importSpecifiers) {
		const unresolvedPath = resolve(dirname(project.configFile), specifier);
		const importedFile = [
			unresolvedPath,
			...[
				".ts",
				".tsx",
				".mts",
				".cts",
				".js",
				".jsx",
				".mjs",
				".cjs"
			].map((extension) => `${unresolvedPath}${extension}`),
			...[
				".ts",
				".tsx",
				".mts",
				".cts",
				".js",
				".jsx",
				".mjs",
				".cjs"
			].map((extension) => resolve(unresolvedPath, `index${extension}`))
		].find((candidate) => existsSync(candidate));
		if (!importedFile) continue;
		try {
			if (/\bstaticTarget\s*:\s*true\b/.test(maskCommentsAndStrings(readFileSync(importedFile, "utf-8")))) return true;
		} catch {}
	}
	return false;
}
function projectDeclaresApiRoutes(project) {
	const apiDir = resolveProjectPath(project.root, project.apiDir);
	return existsSync(apiDir) && listFilesRecursively(apiDir).some((file) => MODULE_SOURCE_RE.test(file));
}
function collectConstraintChecks(project, live, checks) {
	const constraints = live.constraints;
	if (constraints.length === 0) return;
	const violations = evaluateConstraints(live.routes, constraints, { routeHasHead: (route) => routeHasHeadExport(project, route) });
	if (violations.length === 0) {
		checks.push(createCheck("ok", `All ${constraints.length} app constraint${constraints.length === 1 ? "" : "s"} hold across ${live.routes.length} route${live.routes.length === 1 ? "" : "s"}.`));
		return;
	}
	for (const violation of violations) checks.push(createCheck("error", violation.message));
}
function collectSnapshotChecks(project, live, checks, snapshotExists) {
	if (!snapshotExists) {
		checks.push(createCheck("ok", `No app graph snapshot yet — run \`pracht plan --write\` and commit ${GRAPH_SNAPSHOT_PATH} to get incremental \`pracht plan\` diffs and snapshot-staleness verification.`));
		return;
	}
	const snapshot = readGraphSnapshotFromDisk(project.root);
	if (!snapshot) {
		checks.push(createCheck("error", `${GRAPH_SNAPSHOT_PATH} exists but could not be parsed. Run \`pracht plan --write\` to regenerate it.`));
		return;
	}
	if (serializeGraphSnapshot(snapshot) === serializeGraphSnapshot(live)) checks.push(createCheck("ok", `App graph snapshot ${GRAPH_SNAPSHOT_PATH} is up to date.`));
	else checks.push(createCheck("error", `App graph snapshot ${GRAPH_SNAPSHOT_PATH} is stale. Run \`pracht plan --write\` and commit the result.`));
}
function manifestDeclaresConstraints(project) {
	if (project.mode !== "manifest") return false;
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	if (!existsSync(manifestPath)) return false;
	return /\bconstraints\s*:/.test(readFileSync(manifestPath, "utf-8"));
}
function manifestDeclaresCapabilities(project) {
	if (project.mode !== "manifest") return false;
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	if (!existsSync(manifestPath)) return false;
	const source = readFileSync(manifestPath, "utf-8");
	return extractCapabilityRegistrations(source).length > 0 || /\bcapabilities\s*:/.test(source);
}
function manifestDeclaresAgents(project) {
	if (project.mode !== "manifest") return false;
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	if (!existsSync(manifestPath)) return false;
	const appBody = extractDefineAppObjectBody(readFileSync(manifestPath, "utf-8"));
	return appBody !== null && (scanTopLevelProperties(appBody).has("agents") || /\bagents\b/.test(maskCommentsAndStrings(appBody)));
}
/**
* Whether the route module (or its shell) exports `head()`. Returns undefined
* when the sources cannot be read, which skips the route.
*/
function routeHasHeadExport(project, route) {
	const routeSource = readModuleSource(project, route.file);
	if (routeSource === null) return void 0;
	if (HEAD_EXPORT_RE.test(routeSource)) return true;
	if (route.shellFile) {
		const shellSource = readModuleSource(project, route.shellFile);
		if (shellSource === null) return void 0;
		return HEAD_EXPORT_RE.test(shellSource);
	}
	return false;
}
function readModuleSource(project, file) {
	try {
		return readFileSync(resolveModuleFile(project, file), "utf-8");
	} catch {
		return null;
	}
}
/**
* Manifest module refs are relative to the manifest file ("./routes/home.tsx");
* pages-router and virtual-module refs are app-absolute ("/src/pages/index.tsx").
*/
function resolveModuleFile(project, file) {
	if (file.startsWith("./") || file.startsWith("../")) return resolve(dirname(resolveProjectPath(project.root, project.appFile)), file);
	return resolveProjectPath(project.root, file);
}
//#endregion
//#region src/verification-scope.ts
function collectChangedFiles(root) {
	const git = {
		encoding: "utf-8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		]
	};
	try {
		const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: root,
			...git
		}).trim();
		const prefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
			cwd: root,
			...git
		}).trim();
		const output = execFileSync("git", [
			"status",
			"--porcelain",
			"--untracked-files=all"
		], {
			cwd: repoRoot,
			...git
		});
		const files = /* @__PURE__ */ new Set();
		for (const line of output.split(/\r?\n/).filter(Boolean)) {
			const record = line.slice(3);
			if (!record) continue;
			if (record.includes(" -> ")) {
				const [from, to] = record.split(" -> ");
				addChangedFile(files, root, prefix, from);
				addChangedFile(files, root, prefix, to);
			} else addChangedFile(files, root, prefix, record);
		}
		return {
			files: [...files],
			warning: null
		};
	} catch {
		return {
			files: [],
			warning: "Unable to determine changed files from git; ran full verification instead."
		};
	}
}
function addChangedFile(files, projectRoot, prefix, repoRelativePath) {
	if (prefix && !repoRelativePath.startsWith(prefix)) return;
	const projectRelativePath = prefix ? repoRelativePath.slice(prefix.length) : repoRelativePath;
	if (!projectRelativePath) return;
	files.add(resolve(projectRoot, projectRelativePath));
}
function filterFrameworkFiles(project, files, packageJsonPath) {
	const appFile = resolveProjectPath(project.root, project.appFile);
	const routesDir = resolveProjectPath(project.root, project.routesDir);
	const shellsDir = resolveProjectPath(project.root, project.shellsDir);
	const middlewareDir = resolveProjectPath(project.root, project.middlewareDir);
	const serverDir = resolveProjectPath(project.root, project.serverDir);
	const apiDir = resolveProjectPath(project.root, project.apiDir);
	const pagesDir = project.pagesDir ? resolveProjectPath(project.root, project.pagesDir) : null;
	return files.filter((file) => {
		if (CONFIG_FILE_NAMES.has(basename(file))) return true;
		if (normalizePath(file) === normalizePath(packageJsonPath)) return true;
		if (project.mode === "manifest" && normalizePath(file) === normalizePath(appFile)) return true;
		if (isWithinDirectory(file, routesDir) && (!project.additionalExtensionsIsStatic || isRouteSource(file, project.additionalExtensions))) return true;
		if (isWithinDirectory(file, shellsDir) && (!project.additionalExtensionsIsStatic || isRouteSource(file, project.additionalExtensions))) return true;
		if (isWithinDirectory(file, middlewareDir) && MODULE_SOURCE_RE.test(file)) return true;
		if (isWithinDirectory(file, serverDir) && MODULE_SOURCE_RE.test(file)) return true;
		if (isWithinDirectory(file, apiDir) && MODULE_SOURCE_RE.test(file)) return true;
		if (pagesDir && isWithinDirectory(file, pagesDir) && (!project.additionalExtensionsIsStatic || isPageSource(file, project.additionalExtensions))) return true;
		return false;
	});
}
function requiresFullVerification(project, changedFiles) {
	const packageJsonPath = resolve(project.root, "package.json");
	const appFile = resolveProjectPath(project.root, project.appFile);
	return changedFiles.some((file) => {
		const normalized = normalizePath(file);
		if (CONFIG_FILE_NAMES.has(basename(file))) return true;
		if (normalized === normalizePath(packageJsonPath)) return true;
		if (project.mode === "manifest" && normalized === normalizePath(appFile)) return true;
		return false;
	});
}
//#endregion
//#region src/verification.ts
async function runDoctor(root) {
	const report = await runVerification(root);
	return {
		checks: report.checks,
		configFile: report.configFile,
		mode: report.mode,
		ok: report.ok
	};
}
async function runVerification(root, options = {}) {
	const project = readProjectConfig(root);
	const checks = [];
	const packageJsonPath = resolve(project.root, "package.json");
	const configDisplayPath = project.configFile ? displayPath(root, project.configFile) : "vite.config.*";
	const requestedScope = options.changed ? "changed" : "full";
	collectConfigChecks(project, checks, configDisplayPath);
	let changedInfo = {
		files: [],
		warning: null
	};
	if (options.changed) {
		changedInfo = collectChangedFiles(project.root);
		if (changedInfo.warning) checks.push(createCheck("warning", changedInfo.warning));
	}
	const frameworkFiles = options.changed ? filterFrameworkFiles(project, changedInfo.files, packageJsonPath) : [];
	const scope = options.changed && !changedInfo.warning && !requiresFullVerification(project, frameworkFiles) ? "changed" : "full";
	if (project.mode === "pages") collectPagesVerification(project, checks, {
		changedFiles: frameworkFiles,
		scope
	});
	else {
		collectManifestVerification(project, checks, {
			changedFiles: frameworkFiles,
			scope
		});
		collectCapabilityChecks(project, checks);
	}
	collectApiVerification(project, checks, {
		changedFiles: frameworkFiles,
		scope
	});
	collectEnvLeakVerification(project, checks, { scope });
	collectPackageChecks(project, checks, packageJsonPath);
	collectBudgetChecks(project, checks);
	await collectGraphChecks(project, checks);
	if (options.changed && frameworkFiles.length === 0 && !changedInfo.warning) checks.push(createCheck("ok", "No changed framework files were detected in the current project scope."));
	return {
		checks,
		configFile: project.configFile ? displayPath(root, project.configFile) : null,
		mode: project.mode,
		ok: !checks.some((check) => check.status === "error"),
		requestedScope,
		scope,
		changedFiles: changedInfo.files.map((file) => displayPath(project.root, file)),
		frameworkFiles: frameworkFiles.map((file) => displayPath(project.root, file))
	};
}
//#endregion
export { runVerification as n, runDoctor as t };
