import { isAbsolute, relative } from "node:path";
//#region src/verification-helpers.ts
const CONFIG_FILE_NAMES = new Set([
	"vite.config.ts",
	"vite.config.mts",
	"vite.config.js",
	"vite.config.mjs",
	"vite.config.cjs",
	"vite.config.cts"
]);
const MODULE_SOURCE_RE = /(?<!\.d)\.(ts|tsx|js|jsx)$/;
const PAGE_SOURCE_RE = /\.(ts|tsx|tsrx|js|jsx|md|mdx)$/;
const DECLARATION_SOURCE_RE = /\.d\.ts$/;
function isPageSource(file, additionalExtensions = []) {
	if (DECLARATION_SOURCE_RE.test(file)) return false;
	return PAGE_SOURCE_RE.test(file) || hasAdditionalExtension(file, additionalExtensions);
}
function isRouteSource(file, additionalExtensions = []) {
	if (DECLARATION_SOURCE_RE.test(file)) return false;
	return PAGE_SOURCE_RE.test(file) || hasAdditionalExtension(file, additionalExtensions);
}
function hasAdditionalExtension(file, additionalExtensions) {
	return additionalExtensions.some((extension) => file.endsWith(extension));
}
function createCheck(status, message) {
	return {
		message,
		status
	};
}
function isWithinDirectory(filePath, directoryPath) {
	const relativePath = relative(directoryPath, filePath);
	return relativePath === "" || !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
function normalizePath(value) {
	return value.replace(/\\/g, "/");
}
function toModuleSpecifier(fromDir, filePath) {
	const relativePath = relative(fromDir, filePath).replace(/\\/g, "/");
	if (relativePath.startsWith(".")) return relativePath;
	return `./${relativePath}`;
}
function normalizeRoutePath(path) {
	if (!path || path === "/") return "/";
	const collapsed = (path.startsWith("/") ? path : `/${path}`).replace(/\/{2,}/g, "/");
	return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}
function resolveApiRoutePath(apiDir, file) {
	let relativePath = relative(apiDir, file).replace(/\\/g, "/");
	relativePath = relativePath.replace(/\.(ts|tsx|js|jsx)$/, "");
	if (relativePath === "index") relativePath = "";
	else relativePath = relativePath.replace(/\/index$/, "");
	relativePath = relativePath.replace(/\[\.\.\.[^\]]+\]/g, "*");
	relativePath = relativePath.replace(/\[([^\]]+)\]/g, ":$1");
	return normalizeRoutePath(relativePath ? `/api/${relativePath}` : "/api");
}
//#endregion
export { isRouteSource as a, normalizeRoutePath as c, isPageSource as i, resolveApiRoutePath as l, MODULE_SOURCE_RE as n, isWithinDirectory as o, createCheck as r, normalizePath as s, CONFIG_FILE_NAMES as t, toModuleSpecifier as u };
