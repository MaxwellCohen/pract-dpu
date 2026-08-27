import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { maskCommentsAndStrings } from "@pracht/capabilities/static";
import { parse } from "@babel/parser";
import { initSync, parse as parse$1 } from "es-module-lexer";
//#region src/route-extensions.ts
const BUILT_IN_ROUTE_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".md",
	".mdx"
];
const LEGACY_BARE_ROUTE_EXTENSIONS = [".tsrx"];
const DEFAULT_ROUTE_EXTENSIONS = [...BUILT_IN_ROUTE_EXTENSIONS, ...LEGACY_BARE_ROUTE_EXTENSIONS];
const DEFAULT_SHELL_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	...LEGACY_BARE_ROUTE_EXTENSIONS
];
const EXTENSION_RE = /^\.[a-z0-9][a-z0-9_-]*$/i;
function normalizeAdditionalExtensions(extensions) {
	if (extensions === void 0) return [];
	if (!Array.isArray(extensions)) throw new Error("pracht({ additionalExtensions }) expects an array of dot-prefixed extensions.");
	const normalized = extensions.map((extension) => {
		if (typeof extension !== "string" || !EXTENSION_RE.test(extension)) throw new Error(`pracht({ additionalExtensions }) expects dot-prefixed extensions such as ".vue", got ${JSON.stringify(extension)}.`);
		return extension.toLowerCase();
	});
	const defaults = new Set(BUILT_IN_ROUTE_EXTENSIONS);
	return [...new Set(normalized)].filter((extension) => !defaults.has(extension));
}
function extensionGlob(extensions) {
	const names = extensions.map((extension) => extension.slice(1));
	return names.length === 1 ? names[0] : `{${names.join(",")}}`;
}
function withAdditionalExtensions(defaults, additionalExtensions) {
	return new Set([...defaults, ...additionalExtensions]);
}
//#endregion
//#region src/route-loader-hints.ts
initSync();
function namedDeclarationRe(exportName) {
	return new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${exportName}\\b`);
}
const HEAD_DECLARATION_RE = namedDeclarationRe("head");
const HEADERS_DECLARATION_RE = namedDeclarationRe("headers");
const STATIC_PATHS_DECLARATION_RE = namedDeclarationRe("getStaticPaths");
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}\s*(?:from\s*["'][^"']+["'])?/g;
const EXPORT_ALL_RE = /export\s+\*\s+from\b/;
const EXPORT_VARIABLE_DECLARATION_RE = /export\s+(?:const|let|var)\b/g;
function isExportAllStatement(source) {
	const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, " ");
	return /^\s*export\s*\*/.test(withoutComments);
}
function exportedVariableDeclarationIncludesLoader(source) {
	for (const declaration of source.matchAll(/\bexport\s+(?:const|let|var)\b/g)) {
		let index = (declaration.index ?? 0) + declaration[0].length;
		while (index < source.length) {
			while (/\s/.test(source[index] ?? "")) index += 1;
			const bindingStart = index;
			const opening = source[index];
			if (opening === "{" || opening === "[") {
				const closing = opening === "{" ? "}" : "]";
				let depth = 0;
				do {
					const char = source[index++];
					if (char === opening) depth += 1;
					if (char === closing) depth -= 1;
				} while (index < source.length && depth > 0);
				if (/\bloader\b/.test(source.slice(bindingStart, index))) return true;
			} else {
				const binding = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
				if (!binding) break;
				if (binding[0] === "loader") return true;
				index += binding[0].length;
			}
			let parentheses = 0;
			let brackets = 0;
			let braces = 0;
			for (; index < source.length; index += 1) {
				const char = source[index];
				if (char === "(") parentheses += 1;
				else if (char === ")") parentheses = Math.max(0, parentheses - 1);
				else if (char === "[") brackets += 1;
				else if (char === "]") brackets = Math.max(0, brackets - 1);
				else if (char === "{") braces += 1;
				else if (char === "}") braces = Math.max(0, braces - 1);
				if (parentheses === 0 && brackets === 0 && braces === 0) {
					if (char === ";") break;
					if (char === ",") {
						index += 1;
						break;
					}
				}
			}
			if (source[index] === ";" || index >= source.length) break;
		}
	}
	return false;
}
function detectLoaderExportFallback(source) {
	const masked = maskCommentsAndStrings(source);
	if (/\bexport\s+(?:async\s+)?function\s+loader\b/.test(masked)) return true;
	if (exportedVariableDeclarationIncludesLoader(masked)) return true;
	if (/\bexport\s*\*/.test(masked)) return true;
	for (const match of masked.matchAll(/\bexport\s*\{([^}]*)\}/g)) if (match[1].split(",").map((specifier) => specifier.trim()).filter(Boolean).some((specifier) => {
		const names = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier);
		if (!names || specifier.startsWith("type ")) return false;
		return (names[2] ?? names[1]) === "loader";
	})) return true;
	return false;
}
function topLevelAssignmentIndex(source) {
	let parentheses = 0;
	let brackets = 0;
	let braces = 0;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (char === "(") parentheses += 1;
		else if (char === ")") parentheses = Math.max(0, parentheses - 1);
		else if (char === "[") brackets += 1;
		else if (char === "]") brackets = Math.max(0, brackets - 1);
		else if (char === "{") braces += 1;
		else if (char === "}") braces = Math.max(0, braces - 1);
		else if (char === "=" && parentheses === 0 && brackets === 0 && braces === 0) return index;
	}
	return -1;
}
function bindingExportsName(source, exportName) {
	const assignmentIndex = topLevelAssignmentIndex(source);
	const binding = assignmentIndex === -1 ? source : source.slice(0, assignmentIndex);
	return new RegExp(`\\b${exportName}\\b`).test(binding);
}
function variableDeclarationExports(source, exportName) {
	for (const match of source.matchAll(EXPORT_VARIABLE_DECLARATION_RE)) {
		let declarationStart = (match.index ?? 0) + match[0].length;
		let parentheses = 0;
		let brackets = 0;
		let braces = 0;
		for (let index = declarationStart; index <= source.length; index += 1) {
			const char = source[index];
			if (char === "(") parentheses += 1;
			else if (char === ")") parentheses = Math.max(0, parentheses - 1);
			else if (char === "[") brackets += 1;
			else if (char === "]") brackets = Math.max(0, brackets - 1);
			else if (char === "{") braces += 1;
			else if (char === "}") braces = Math.max(0, braces - 1);
			if (parentheses === 0 && brackets === 0 && braces === 0 && (char === "," || char === ";" || char === void 0)) {
				if (bindingExportsName(source.slice(declarationStart, index), exportName)) return true;
				if (char !== ",") break;
				declarationStart = index + 1;
			}
		}
	}
	return false;
}
function exportSpecifiersInclude(specifiers, exportName) {
	return specifiers.split(",").map((specifier) => specifier.trim()).filter(Boolean).some((specifier) => {
		const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier);
		if (!match) return false;
		const [, localName, exportedName] = match;
		return (exportedName ?? localName) === exportName;
	});
}
/**
* Whether `source` exports `exportName`, via a declaration, an export block,
* or an `export *` re-export (which could expose anything, so it counts).
*
* Ordinary TS/JS is parsed exactly, including string-literal export names.
* Custom syntaxes fall back to masked lexical detection so prose or a string
* literal mentioning the name cannot produce a false positive.
*/
function detectNamedExport(source, exportName, declarationRe) {
	const parsedResult = inspectParsedModule(source, exportName);
	if (parsedResult !== void 0) return parsedResult;
	const analysisSource = maskCommentsAndStrings(source);
	if (declarationRe.test(analysisSource) || variableDeclarationExports(analysisSource, exportName)) return true;
	for (const match of analysisSource.matchAll(EXPORT_BLOCK_RE)) if (exportSpecifiersInclude(match[1], exportName)) return true;
	return EXPORT_ALL_RE.test(analysisSource);
}
function detectHeadExport(source) {
	return detectNamedExport(source, "head", HEAD_DECLARATION_RE);
}
/** Whether the route or shell module exports document response headers. */
function detectHeadersExport(source) {
	return detectNamedExport(source, "headers", HEADERS_DECLARATION_RE);
}
/**
* Whether the route module exports `getStaticPaths()`.
*
* Only a static export consumes this: it decides whether a dynamic route has
* any prerendered path at all, and therefore whether the client should ever
* request a route-state file for it. Unknown answers must stay `true` — the
* cost of a wrong `true` is the request the client already makes today, while
* a wrong `false` would drop state the build did write.
*/
function detectStaticPathsExport(source) {
	return detectNamedExport(source, "getStaticPaths", STATIC_PATHS_DECLARATION_RE);
}
function isSyntaxNode(value) {
	return typeof value === "object" && value !== null && typeof value.type === "string";
}
function bindingIncludesName(node, exportName) {
	if (!isSyntaxNode(node)) return false;
	if (node.type === "Identifier") return node.name === exportName;
	if (node.type === "AssignmentPattern") return bindingIncludesName(node.left, exportName);
	if (node.type === "RestElement") return bindingIncludesName(node.argument, exportName);
	if (node.type === "ArrayPattern") return Array.isArray(node.elements) && node.elements.some((element) => bindingIncludesName(element, exportName));
	if (node.type === "ObjectPattern") return Array.isArray(node.properties) && node.properties.some((property) => {
		if (!isSyntaxNode(property)) return false;
		return property.type === "RestElement" ? bindingIncludesName(property.argument, exportName) : bindingIncludesName(property.value, exportName);
	});
	return false;
}
function exportedNameMatches(node, exportName) {
	if (!isSyntaxNode(node)) return false;
	if (node.type === "Identifier") return node.name === exportName;
	if (node.type === "StringLiteral") return node.value === exportName;
	return false;
}
function inspectParsedModule(source, exportName) {
	for (const plugins of [["typescript", "jsx"], ["typescript"]]) {
		let body;
		try {
			body = parse(source, {
				plugins: [...plugins],
				sourceType: "module"
			}).program.body;
		} catch {
			continue;
		}
		for (const statement of body) {
			if (statement.type === "ExportAllDeclaration") {
				if (statement.exportKind !== "type") return true;
				continue;
			}
			if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;
			if (Array.isArray(statement.specifiers) && statement.specifiers.some((specifier) => isSyntaxNode(specifier) && specifier.exportKind !== "type" && exportedNameMatches(specifier.exported, exportName))) return true;
			const declaration = statement.declaration;
			if (!isSyntaxNode(declaration)) continue;
			if (declaration.declare === true || declaration.type.startsWith("TS")) continue;
			if (declaration.type === "VariableDeclaration") {
				if (Array.isArray(declaration.declarations) && declaration.declarations.some((declarator) => isSyntaxNode(declarator) && bindingIncludesName(declarator.id, exportName))) return true;
			} else if (bindingIncludesName(declaration.id, exportName)) return true;
		}
		return false;
	}
}
function detectLoaderExport(source) {
	const parsedResult = inspectParsedModule(source, "loader");
	if (parsedResult !== void 0) return parsedResult;
	try {
		const [imports, exports] = parse$1(source);
		if (exports.some((entry) => entry.n === "loader")) return true;
		for (const entry of imports) if (entry.d === -1 && isExportAllStatement(source.slice(entry.ss, entry.se))) return true;
	} catch {}
	return detectLoaderExportFallback(source);
}
function scanRouteFiles(dir, files, extensions) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const abs = join(dir, entry);
		if (statSync(abs).isDirectory()) {
			scanRouteFiles(abs, files, extensions);
			continue;
		}
		if (extensions.has(extname(entry))) files.push(abs);
	}
}
function toPosixPath(path) {
	return path.replace(/\\/g, "/");
}
function createRouteLoaderHints(routesDir, options = {}) {
	const files = [];
	const hints = {};
	scanRouteFiles(routesDir, files, withAdditionalExtensions(DEFAULT_ROUTE_EXTENSIONS, normalizeAdditionalExtensions(options.additionalExtensions)));
	for (const file of files) {
		const hasLoader = detectLoaderExport(readFileSync(file, "utf-8"));
		const relativeToRoutesDir = toPosixPath(relative(routesDir, file));
		const routeRootPrefix = options.rootRelativePrefix?.replace(/\/$/, "");
		const appFileDir = options.appFileDir;
		const keys = /* @__PURE__ */ new Set();
		if (appFileDir) {
			const relativeToAppFile = toPosixPath(relative(appFileDir, file));
			keys.add(relativeToAppFile.startsWith(".") ? relativeToAppFile : `./${relativeToAppFile}`);
		}
		if (routeRootPrefix) keys.add(`${routeRootPrefix}/${relativeToRoutesDir}`);
		for (const key of keys) hints[key] = hasLoader;
	}
	return hints;
}
function createRouteHeadHints(routesDir, options = {}) {
	const files = [];
	const hints = {};
	const additionalExtensions = normalizeAdditionalExtensions(options.additionalExtensions);
	scanRouteFiles(routesDir, files, withAdditionalExtensions(DEFAULT_ROUTE_EXTENSIONS, additionalExtensions));
	for (const file of files) {
		const extension = extname(file);
		const hasHead = extension === ".md" || extension === ".mdx" || additionalExtensions.includes(extension) || detectHeadExport(readFileSync(file, "utf-8"));
		const relativeToRoutesDir = toPosixPath(relative(routesDir, file));
		const routeRootPrefix = options.rootRelativePrefix?.replace(/\/$/, "");
		const keys = /* @__PURE__ */ new Set();
		if (options.appFileDir) {
			const relativeToAppFile = toPosixPath(relative(options.appFileDir, file));
			keys.add(relativeToAppFile.startsWith(".") ? relativeToAppFile : `./${relativeToAppFile}`);
		}
		if (routeRootPrefix) keys.add(`${routeRootPrefix}/${relativeToRoutesDir}`);
		for (const key of keys) hints[key] = hasHead;
	}
	return hints;
}
function createRouteHeadersHints(routesDir, options = {}) {
	const files = [];
	const hints = {};
	const additionalExtensions = normalizeAdditionalExtensions(options.additionalExtensions);
	scanRouteFiles(routesDir, files, withAdditionalExtensions(DEFAULT_ROUTE_EXTENSIONS, additionalExtensions));
	for (const file of files) {
		const extension = extname(file);
		const hasHeaders = extension === ".md" || extension === ".mdx" || additionalExtensions.includes(extension) || detectHeadersExport(readFileSync(file, "utf-8"));
		const relativeToRoutesDir = toPosixPath(relative(routesDir, file));
		const routeRootPrefix = options.rootRelativePrefix?.replace(/\/$/, "");
		const keys = /* @__PURE__ */ new Set();
		if (options.appFileDir) {
			const relativeToAppFile = toPosixPath(relative(options.appFileDir, file));
			keys.add(relativeToAppFile.startsWith(".") ? relativeToAppFile : `./${relativeToAppFile}`);
		}
		if (routeRootPrefix) keys.add(`${routeRootPrefix}/${relativeToRoutesDir}`);
		for (const key of keys) hints[key] = hasHeaders;
	}
	return hints;
}
/**
* Per-route-file `getStaticPaths()` presence, keyed the same way as the loader
* and head hints.
*
* Formats compiled by a companion Vite plugin are reported as `true`: raw
* source scanning cannot prove such a module has no `getStaticPaths`, and the
* conservative answer keeps today's behavior.
*/
function createRouteStaticPathsHints(routesDir, options = {}) {
	const files = [];
	const hints = {};
	const additionalExtensions = normalizeAdditionalExtensions(options.additionalExtensions);
	scanRouteFiles(routesDir, files, withAdditionalExtensions(DEFAULT_ROUTE_EXTENSIONS, additionalExtensions));
	for (const file of files) {
		const extension = extname(file);
		const hasStaticPaths = additionalExtensions.includes(extension) || detectStaticPathsExport(readFileSync(file, "utf-8"));
		const relativeToRoutesDir = toPosixPath(relative(routesDir, file));
		const routeRootPrefix = options.rootRelativePrefix?.replace(/\/$/, "");
		const keys = /* @__PURE__ */ new Set();
		if (options.appFileDir) {
			const relativeToAppFile = toPosixPath(relative(options.appFileDir, file));
			keys.add(relativeToAppFile.startsWith(".") ? relativeToAppFile : `./${relativeToAppFile}`);
		}
		if (routeRootPrefix) keys.add(`${routeRootPrefix}/${relativeToRoutesDir}`);
		for (const key of keys) hints[key] = hasStaticPaths;
	}
	return hints;
}
//#endregion
//#region src/pages-router.ts
function scanPagesDirectory(pagesDir, additionalExtensions = []) {
	const normalizedExtensions = normalizeAdditionalExtensions(additionalExtensions);
	const pageExtensions = withAdditionalExtensions(DEFAULT_ROUTE_EXTENSIONS, normalizedExtensions);
	const shellExtensions = withAdditionalExtensions(DEFAULT_SHELL_EXTENSIONS, normalizedExtensions);
	const pages = [];
	scan(pagesDir, pagesDir, pages, pageExtensions, shellExtensions, new Set(normalizedExtensions));
	const appShell = pages.find((page) => page.routePath === "__shell__");
	if (appShell?.hasRevalidateExport) throw new Error(`[pracht] Pages app shell ${JSON.stringify(appShell.relativePath)} exports REVALIDATE, but app shells are not ISG routes. Declare the policy on each ISG page instead.`);
	return sortRoutes(pages);
}
function scan(dir, root, pages, pageExtensions, shellExtensions, additionalExtensions) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const abs = join(dir, entry);
		if (statSync(abs).isDirectory()) {
			scan(abs, root, pages, pageExtensions, shellExtensions, additionalExtensions);
			continue;
		}
		const ext = extname(entry);
		if (!pageExtensions.has(ext)) continue;
		const name = basename(entry, ext);
		if (name === "_app" && !shellExtensions.has(ext)) continue;
		if (name.startsWith("_") && name !== "_app") continue;
		const rel = relative(root, abs);
		const routePath = filePathToRoutePath(rel);
		const analysisSource = maskMarkdownFences(readFileSync(abs, "utf-8"), rel);
		const renderMode = extractQuotedPageExport(analysisSource, "RENDER_MODE", rel);
		const hydrationMode = extractQuotedPageExport(analysisSource, "HYDRATION", rel);
		const revalidate = extractRevalidateSeconds(analysisSource, rel);
		const hasLoader = detectLoaderExport(analysisSource);
		const hasHead = ext === ".md" || ext === ".mdx" || additionalExtensions.has(ext) || detectHeadExport(analysisSource);
		const hasHeaders = ext === ".md" || ext === ".mdx" || additionalExtensions.has(ext) || detectHeadersExport(analysisSource);
		pages.push({
			absolutePath: abs,
			relativePath: rel,
			routePath,
			isIndex: name === "index",
			isCatchAll: routePath.split("/").includes("*"),
			isDynamic: routePath.split("/").some((segment) => segment.startsWith(":")),
			renderMode,
			hydrationMode,
			revalidateSeconds: revalidate.seconds,
			hasRevalidateExport: revalidate.present,
			hasLoader,
			hasHead,
			hasHeaders
		});
	}
}
function filePathToRoutePath(relativePath) {
	const extension = extname(relativePath);
	let route = extension ? relativePath.slice(0, -extension.length) : relativePath;
	route = route.replace(/\\/g, "/");
	if (route === "_app" || route.endsWith("/_app")) return "__shell__";
	if (route === "index") return "/";
	route = route.replace(/\/index$/, "");
	route = route.replace(/\[([^\].]+)\]/g, ":$1");
	route = route.replace(/\[\.\.\.([^\]]+)\]/g, "*");
	return `/${route}`;
}
function sortRoutes(pages) {
	return [...pages].filter((p) => p.routePath !== "__shell__").sort(comparePagesBySpecificity);
}
function comparePagesBySpecificity(left, right) {
	const leftSegments = splitRoutePath(left.routePath);
	const rightSegments = splitRoutePath(right.routePath);
	const length = Math.max(leftSegments.length, rightSegments.length);
	for (let index = 0; index < length; index += 1) {
		const leftSegment = leftSegments[index];
		const rightSegment = rightSegments[index];
		if (!leftSegment) return -1;
		if (!rightSegment) return 1;
		const leftScore = getRouteSegmentSpecificity(leftSegment);
		const rightScore = getRouteSegmentSpecificity(rightSegment);
		if (leftScore !== rightScore) return rightScore - leftScore;
		if (leftScore === 3 && leftSegment !== rightSegment) return leftSegment.localeCompare(rightSegment);
	}
	return left.routePath.localeCompare(right.routePath);
}
function splitRoutePath(routePath) {
	return routePath.split("/").filter(Boolean);
}
function getRouteSegmentSpecificity(segment) {
	if (segment === "*") return 1;
	if (segment.startsWith(":")) return 2;
	return 3;
}
function extractQuotedPageExport(source, name, relativePath) {
	const declarations = [...maskCommentsAndStrings(source).matchAll(new RegExp(`export\\s+const\\s+${name}\\s*=`, "g"))];
	if (declarations.length === 0) return void 0;
	if (declarations.length > 1) throw new Error(`[pracht] Pages route ${JSON.stringify(relativePath)} exports ${name} more than once.`);
	const declaration = declarations[0];
	const valueStart = (declaration.index ?? 0) + declaration[0].length;
	return source.slice(valueStart).trimStart().match(/^["'](\w+)["']/)?.[1];
}
const REVALIDATE_RE = /export\s+const\s+REVALIDATE\s*=\s*([^;\n]+)/;
function extractRevalidateSeconds(source, relativePath) {
	const matches = [...maskCommentsAndStrings(source).matchAll(new RegExp(REVALIDATE_RE, "g"))];
	if (matches.length === 0) return { present: false };
	if (matches.length > 1) throw new Error(`[pracht] Pages route ${JSON.stringify(relativePath)} exports REVALIDATE more than once.`);
	const expression = matches[0][1].trim().replace(/\s+as\s+const$/, "");
	if (!/^\d(?:_?\d)*$/.test(expression)) throw new Error(`[pracht] Pages route ${JSON.stringify(relativePath)} must export REVALIDATE as a positive integer literal number of seconds (for example, \`export const REVALIDATE = 60\`).`);
	const seconds = Number(expression.replaceAll("_", ""));
	if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error(`[pracht] Pages route ${JSON.stringify(relativePath)} must export REVALIDATE as a positive integer literal number of seconds within JavaScript's safe integer range.`);
	return {
		present: true,
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
function generatePagesManifestSource(pages, options) {
	const pagesDir = options.pagesDir;
	const defaultRender = options.pagesDefaultRender ?? "ssr";
	const prefix = options.pagesDirPrefix;
	const useImport = options.useImportSyntax ?? false;
	const shellExtensions = withAdditionalExtensions(DEFAULT_SHELL_EXTENSIONS, normalizeAdditionalExtensions(options.additionalExtensions));
	const appFile = scanAllFiles(pagesDir).find((f) => basename(f, extname(f)) === "_app" && shellExtensions.has(extname(f)));
	const lines = [`import { ${pages.some((page) => page.revalidateSeconds !== void 0) ? "defineApp, group, route, timeRevalidate" : "defineApp, group, route"} } from "@pracht/core/manifest";`, ""];
	const routeEntries = [];
	const notFoundPage = pages.find((page) => page.routePath === "/404");
	if (notFoundPage?.hasRevalidateExport) throw new Error(`[pracht] Pages not-found module ${JSON.stringify(notFoundPage.relativePath)} exports REVALIDATE, but not-found responses are never ISG routes.`);
	for (const page of pages) {
		if (page === notFoundPage) continue;
		const render = page.renderMode ?? defaultRender;
		if (render === "isg" && page.revalidateSeconds === void 0) throw new Error(`[pracht] Pages route ${JSON.stringify(page.relativePath)} uses render mode "isg" but does not export a revalidation policy. Add \`export const REVALIDATE = 60\` with a positive integer number of seconds, or use another render mode.`);
		if (render !== "isg" && page.hasRevalidateExport) throw new Error(`[pracht] Pages route ${JSON.stringify(page.relativePath)} exports REVALIDATE but its effective render mode is ${JSON.stringify(render)}. REVALIDATE is only valid with \`RENDER_MODE = "isg"\` (or \`pagesDefaultRender: "isg"\`).`);
		const filePath = prefix ? `${prefix}/${page.relativePath.replace(/\\/g, "/")}` : `./${page.relativePath.replace(/\\/g, "/")}`;
		const fileRef = useImport ? `() => import(${JSON.stringify(filePath)})` : JSON.stringify(filePath);
		const metaParts = [
			`render: ${JSON.stringify(render)}`,
			`hasLoader: ${page.hasLoader ? "true" : "false"}`,
			`hasHead: ${page.hasHead ? "true" : "false"}`
		];
		if (page.hydrationMode) metaParts.push(`hydration: ${JSON.stringify(page.hydrationMode)}`);
		if (page.revalidateSeconds !== void 0) metaParts.push(`revalidate: timeRevalidate(${page.revalidateSeconds})`);
		routeEntries.push(`    route(${JSON.stringify(page.routePath)}, ${fileRef}, { ${metaParts.join(", ")} })`);
	}
	const notFoundEntry = notFoundPage ? buildNotFoundEntry(notFoundPage, {
		prefix,
		useImport,
		withShell: !!appFile
	}) : null;
	if (appFile) {
		const appPath = prefix ? `${prefix}/_app.${extname(appFile).slice(1)}` : `./${relative(join(pagesDir, ".."), appFile).replace(/\\/g, "/")}`;
		const shellRef = useImport ? `() => import(${JSON.stringify(appPath)})` : JSON.stringify(appPath);
		lines.push("const app = defineApp({");
		lines.push("  shells: {");
		lines.push(`    pages: ${shellRef},`);
		lines.push("  },");
		lines.push("  routes: [");
		lines.push(`    group({ shell: "pages" }, [`);
		lines.push(routeEntries.join(",\n"));
		lines.push("    ]),");
		lines.push("  ],");
		if (notFoundEntry) lines.push(notFoundEntry);
		lines.push("});");
	} else {
		lines.push("const app = defineApp({");
		lines.push("  routes: [");
		lines.push(routeEntries.join(",\n"));
		lines.push("  ],");
		if (notFoundEntry) lines.push(notFoundEntry);
		lines.push("});");
	}
	lines.push("");
	return lines.join("\n");
}
function buildNotFoundEntry(page, options) {
	const filePath = options.prefix ? `${options.prefix}/${page.relativePath.replace(/\\/g, "/")}` : `./${page.relativePath.replace(/\\/g, "/")}`;
	const configParts = [`component: ${options.useImport ? `() => import(${JSON.stringify(filePath)})` : JSON.stringify(filePath)}`];
	if (options.withShell) configParts.push("shell: \"pages\"");
	if (page.hydrationMode) configParts.push(`hydration: ${JSON.stringify(page.hydrationMode)}`);
	return `  notFound: { ${configParts.join(", ")} },`;
}
function scanAllFiles(dir) {
	const results = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return results;
	}
	for (const entry of entries) {
		const abs = join(dir, entry);
		if (statSync(abs).isDirectory()) results.push(...scanAllFiles(abs));
		else results.push(abs);
	}
	return results;
}
function generateRoutesFile(pagesDir, outputPath, options) {
	writeFileSync(outputPath, [
		"// Auto-generated from pages/ directory by @pracht/vite-plugin.",
		"// Customize this file and remove `pagesDir` from pracht config to use it directly.",
		"",
		generatePagesManifestSource(scanPagesDirectory(pagesDir, options.additionalExtensions), {
			...options,
			useImportSyntax: true
		}).replace("const app = defineApp(", "export const app = defineApp(")
	].join("\n"), "utf-8");
}
//#endregion
export { sortRoutes as a, createRouteLoaderHints as c, LEGACY_BARE_ROUTE_EXTENSIONS as d, extensionGlob as f, scanPagesDirectory as i, createRouteStaticPathsHints as l, withAdditionalExtensions as m, generatePagesManifestSource as n, createRouteHeadHints as o, normalizeAdditionalExtensions as p, generateRoutesFile as r, createRouteHeadersHints as s, filePathToRoutePath as t, DEFAULT_ROUTE_EXTENSIONS as u };
