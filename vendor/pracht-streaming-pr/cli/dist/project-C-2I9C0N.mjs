import { n as PROJECT_DEFAULTS, t as HTTP_METHODS } from "./index.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { maskCommentsAndStrings } from "@pracht/capabilities/static";
//#region src/utils.ts
function quote(value) {
	return JSON.stringify(value);
}
function ensureTrailingNewline(value) {
	return value.endsWith("\n") ? value : `${value}\n`;
}
function parseCommaList(value) {
	if (!value || typeof value === "boolean") return [];
	return (Array.isArray(value) ? value : [value]).flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean);
}
function parseApiMethods(value) {
	const methods = parseCommaList(value);
	const normalized = methods.length === 0 ? ["GET"] : methods.map((entry) => entry.toUpperCase());
	for (const method of normalized) if (!HTTP_METHODS.has(method)) throw new Error(`Unsupported HTTP method "${method}".`);
	return [...new Set(normalized)];
}
function requireEnum(value, key, allowed, fallback) {
	const val = value ?? fallback;
	if (!allowed.includes(val)) throw new Error(`Invalid value for --${key}. Expected one of ${allowed.join(", ")}.`);
	return val;
}
function requirePositiveInteger(value, key, fallback) {
	const parsed = value == null || value === "" ? fallback : Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${key} must be a positive integer.`);
	return parsed;
}
function handleCliError(error, { json }) {
	const message = error instanceof Error ? error.message : String(error);
	if (json) console.error(JSON.stringify({
		ok: false,
		error: message
	}, null, 2));
	else {
		console.error(message);
		if (error instanceof Error && error.stack && process.env.DEBUG) console.error(error.stack);
	}
	process.exit(1);
}
//#endregion
//#region src/project.ts
const BUILT_IN_ROUTE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".md",
	".mdx"
]);
function readProjectConfig(root) {
	const configFile = findConfigFile(root);
	const rawConfig = configFile ? readFileSync(configFile, "utf-8") : "";
	const hasPagesDefaultRender = hasConfigProperty(rawConfig, "pagesDefaultRender");
	const resolvedPagesDefaultRender = readQuotedConfigValue(rawConfig, "pagesDefaultRender");
	const hasAdditionalExtensions = hasConfigValue(rawConfig, "additionalExtensions");
	const resolvedAdditionalExtensions = readQuotedConfigArray(rawConfig, "additionalExtensions");
	const config = {
		...PROJECT_DEFAULTS,
		configFile,
		hasPrachtPlugin: /\bpracht\s*\(/.test(maskCommentsAndStrings(rawConfig)),
		mode: "manifest",
		rawConfig,
		root,
		additionalExtensionsIsStatic: !hasAdditionalExtensions || resolvedAdditionalExtensions !== null,
		pagesDefaultRenderIsStatic: !hasPagesDefaultRender || resolvedPagesDefaultRender !== null
	};
	for (const key of Object.keys(PROJECT_DEFAULTS)) {
		if (key === "additionalExtensions") continue;
		const value = readQuotedConfigValue(rawConfig, key);
		if (typeof value === "string") config[key] = key === "pagesDefaultRender" ? value : normalizeConfigPath(value);
	}
	config.additionalExtensions = [...new Set((resolvedAdditionalExtensions ?? []).map((extension) => extension.toLowerCase()))].filter((extension) => !BUILT_IN_ROUTE_EXTENSIONS.has(extension));
	config.mode = config.pagesDir ? "pages" : "manifest";
	return config;
}
function resolveProjectPath(root, configPath) {
	return resolve(root, `.${configPath}`);
}
function resolveScopedFile(root, configDir, fileName) {
	assertSafePathSegment(fileName.replace(/\.(ts|tsx|js|jsx)$/, ""));
	const baseDir = resolveProjectPath(root, configDir);
	const filePath = resolve(baseDir, fileName);
	assertInsideDirectory(baseDir, filePath);
	return filePath;
}
function resolveRouteModulePath(project, routePath, extension) {
	const segments = segmentsFromPath(routePath);
	const relativePath = segments.length === 0 ? `index${extension}` : `${segments.join("/")}${extension}`;
	const baseDir = resolveProjectPath(project.root, project.routesDir);
	const absolutePath = resolve(baseDir, relativePath);
	assertInsideDirectory(baseDir, absolutePath);
	return {
		absolutePath,
		relativePath
	};
}
function resolvePagesRouteModulePath(project, routePath, extension) {
	const segments = segmentsFromPath(routePath);
	const relativePath = segments.length === 0 ? `index${extension}` : `${segments.join("/")}${extension}`;
	const baseDir = resolveProjectPath(project.root, project.pagesDir);
	const absolutePath = resolve(baseDir, relativePath);
	assertInsideDirectory(baseDir, absolutePath);
	return {
		absolutePath,
		relativePath
	};
}
function resolveApiModulePath(project, endpointPath) {
	const segments = segmentsFromPath(endpointPath);
	const relativePath = segments.length === 0 ? "index.ts" : `${segments.join("/")}.ts`;
	const baseDir = resolveProjectPath(project.root, project.apiDir);
	const absolutePath = resolve(baseDir, relativePath);
	assertInsideDirectory(baseDir, absolutePath);
	return {
		absolutePath,
		relativePath
	};
}
function displayPath(root, filePath) {
	return (relative(root, filePath) || ".").replace(/\\/g, "/");
}
function writeGeneratedFile(filePath, source) {
	if (existsSync(filePath)) throw new Error(`Refusing to overwrite existing file ${filePath}.`);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, ensureTrailingNewline(source), "utf-8");
}
function assertFileExists(filePath, message) {
	if (!existsSync(filePath)) throw new Error(message);
}
function listFilesRecursively(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = resolve(dir, entry.name);
		if (entry.isDirectory()) files.push(...listFilesRecursively(fullPath));
		else files.push(fullPath);
	}
	return files;
}
function hasPagesAppShell(filePath, additionalExtensions = []) {
	const extension = basename(filePath).slice(4);
	return basename(filePath).startsWith("_app.") && new Set([
		".ts",
		".tsx",
		".tsrx",
		".js",
		".jsx",
		...additionalExtensions
	]).has(extension);
}
function findConfigFile(root) {
	for (const name of [
		"vite.config.ts",
		"vite.config.mts",
		"vite.config.js",
		"vite.config.mjs",
		"vite.config.cjs",
		"vite.config.cts"
	]) {
		const file = resolve(root, name);
		if (existsSync(file)) return file;
	}
	return null;
}
function readQuotedConfigValue(source, key) {
	if (!source) return null;
	const masked = maskCommentsAndStrings(source);
	const properties = [...masked.matchAll(new RegExp(`\\b${key}\\s*:`, "g"))];
	if (properties.length !== 1) return null;
	const property = properties[0];
	const valueStart = (property.index ?? 0) + property[0].length;
	const direct = readQuotedValueAt(source, valueStart);
	if (direct !== null) return direct;
	const identifier = /^\s*([A-Za-z_$][\w$]*)\b/.exec(source.slice(valueStart))?.[1];
	if (!identifier) return null;
	const declarations = [...masked.matchAll(new RegExp(`\\bconst\\s+${identifier}\\s*=`, "g"))];
	if (declarations.length !== 1) return null;
	const declaration = declarations[0];
	return readQuotedValueAt(source, (declaration.index ?? 0) + declaration[0].length);
}
function readQuotedConfigArray(source, key) {
	if (!source) return null;
	const masked = maskCommentsAndStrings(source);
	const properties = [...masked.matchAll(new RegExp(`\\b${key}\\s*:`, "g"))];
	if (properties.length > 1) return null;
	let identifier;
	if (properties.length === 1) {
		const property = properties[0];
		const valueStart = (property.index ?? 0) + property[0].length;
		const direct = readStringArrayAt(source, valueStart);
		if (direct !== null) return direct;
		identifier = /^\s*([A-Za-z_$][\w$]*)\b/.exec(source.slice(valueStart))?.[1];
	} else {
		if ([...masked.matchAll(new RegExp(`\\b${key}\\b(?=\\s*[,}])`, "g"))].length !== 1) return null;
		identifier = key;
	}
	if (!identifier) return null;
	const declarations = [...masked.matchAll(new RegExp(`\\bconst\\s+${identifier}\\s*=`, "g"))];
	if (declarations.length !== 1) return null;
	const declaration = declarations[0];
	return readStringArrayAt(source, (declaration.index ?? 0) + declaration[0].length);
}
function readStringArrayAt(source, start) {
	const values = [];
	let offset = skipConfigTrivia(source, start);
	if (source[offset] !== "[") return null;
	offset += 1;
	while (offset < source.length) {
		offset = skipConfigTrivia(source, offset);
		if (source[offset] === "]") return values;
		const quote = source[offset];
		if (quote !== "\"" && quote !== "'" && quote !== "`") return null;
		const valueStart = offset + 1;
		offset = valueStart;
		while (offset < source.length && source[offset] !== quote) {
			if (source[offset] === "\\" || quote === "`" && source.startsWith("${", offset)) return null;
			offset += 1;
		}
		if (offset === source.length || offset === valueStart) return null;
		values.push(source.slice(valueStart, offset));
		offset = skipConfigTrivia(source, offset + 1);
		if (source[offset] === "]") return values;
		if (source[offset] !== ",") return null;
		offset += 1;
	}
	return null;
}
function skipConfigTrivia(source, start) {
	let offset = start;
	while (offset < source.length) {
		if (/\s/.test(source[offset])) {
			offset += 1;
			continue;
		}
		if (source.startsWith("//", offset)) {
			const newline = source.indexOf("\n", offset + 2);
			offset = newline === -1 ? source.length : newline + 1;
			continue;
		}
		if (source.startsWith("/*", offset)) {
			const end = source.indexOf("*/", offset + 2);
			offset = end === -1 ? source.length : end + 2;
			continue;
		}
		break;
	}
	return offset;
}
function hasConfigProperty(source, key) {
	return new RegExp(`\\b${key}\\s*:`).test(maskCommentsAndStrings(source));
}
function hasConfigValue(source, key) {
	const masked = maskCommentsAndStrings(source);
	return new RegExp(`\\b${key}\\s*:`).test(masked) || new RegExp(`\\b${key}\\b(?=\\s*[,}])`).test(masked);
}
function readQuotedValueAt(source, start) {
	return /^\s*(["'`])([^"'`]+)\1/.exec(source.slice(start))?.[2] ?? null;
}
function normalizeConfigPath(value) {
	if (!value) return value;
	return value.startsWith("/") ? value : `/${value}`;
}
function segmentsFromPath(path) {
	return path.split("/").filter(Boolean).map((segment) => {
		assertSafePathSegment(segment);
		if (segment.startsWith(":")) {
			const name = segment.endsWith("*") ? segment.slice(1, -1) : segment.slice(1);
			assertSafePathSegment(name);
			return segment.endsWith("*") ? `[...${name || "slug"}]` : `[${name}]`;
		}
		if (segment === "*") return "[...slug]";
		return segment;
	});
}
function assertSafePathSegment(segment) {
	if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) throw new Error(`Unsafe path segment: ${JSON.stringify(segment)}.`);
}
function assertInsideDirectory(baseDir, filePath) {
	const relativePath = relative(baseDir, filePath);
	if (relativePath === "" || !relativePath.startsWith("..") && !isAbsolute(relativePath)) return;
	throw new Error(`Refusing to write outside ${baseDir}.`);
}
//#endregion
export { requireEnum as _, readProjectConfig as a, resolveProjectPath as c, writeGeneratedFile as d, ensureTrailingNewline as f, quote as g, parseCommaList as h, listFilesRecursively as i, resolveRouteModulePath as l, parseApiMethods as m, displayPath as n, resolveApiModulePath as o, handleCliError as p, hasPagesAppShell as r, resolvePagesRouteModulePath as s, assertFileExists as t, resolveScopedFile as u, requirePositiveInteger as v };
