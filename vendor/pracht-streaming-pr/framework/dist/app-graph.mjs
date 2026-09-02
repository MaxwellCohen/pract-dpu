import { resolveMcpEndpoint } from "./mcp-config.mjs";
import { destructiveMcpPreconditionErrors } from "./runtime-mcp.mjs";
import { capabilityHttpPath } from "@pracht/capabilities";
import { extractCapabilityProjection } from "@pracht/capabilities/static";
//#region src/app-graph.ts
/**
* Shared resolved-app-graph serialization.
*
* Both `pracht inspect` (CLI) and the dev-only `/_pracht` devtools endpoint
* (vite plugin) consume this module so they always report the same graph.
* Module loading and file reading are injected by the caller to keep this
* module platform-neutral.
*/
const API_METHOD_ORDER = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"HEAD",
	"OPTIONS"
];
function serializeAppRoutes(routes) {
	return routes.map((route) => ({
		file: route.file,
		hydration: route.hydration ?? null,
		id: route.id ?? "",
		loaderCache: route.loaderCache ?? null,
		loaderFile: route.loaderFile ?? null,
		...route.markdown === true ? { markdown: true } : {},
		middleware: route.middleware,
		path: route.path,
		prefetch: route.prefetch ?? null,
		render: route.render ?? null,
		revalidate: route.revalidate ?? null,
		shell: route.shell ?? null,
		shellFile: route.shellFile ?? null,
		speculation: route.speculation ?? null,
		streaming: route.streaming ?? null
	}));
}
function serializeApiRoutes(apiRoutes, access, options = {}) {
	return Promise.all(apiRoutes.map(async (route) => {
		try {
			const { hasDefaultHandler, methods } = options.strict ? apiExportsFromModule(await access.loadModule(route.file)) : await detectApiExports(route.file, access);
			return {
				file: route.file,
				hasDefaultHandler,
				methods,
				path: route.path
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to load API route ${JSON.stringify(route.path)} from ${JSON.stringify(route.file)} while resolving the app graph: ${detail}`, { cause: error });
		}
	}));
}
/**
* Serialize API method metadata without executing application modules.
*
* Used by the dev banner, where importing every API route at startup would run
* unrelated top-level application work. Named re-exports expose their names
* directly; star re-exports are followed through the caller's resolver.
*/
function serializeApiRoutesStatic(apiRoutes, access) {
	return Promise.all(apiRoutes.map(async (route) => {
		const { hasDefaultHandler, methods } = await detectApiExportsStatic(route.file, access);
		return {
			file: route.file,
			hasDefaultHandler,
			methods,
			path: route.path
		};
	}));
}
/**
* Serialize registered capabilities by loading their modules. Modules that
* fail to load (or don't export a capability) still appear in the graph with
* null metadata so inspect/devtools can surface the broken registration.
*/
function readProjection(name, file, access) {
	try {
		return extractCapabilityProjection(name, access.readSource(file), (detail) => detail);
	} catch {
		return null;
	}
}
function projectionTransports(projection) {
	if (!projection) return [];
	const transports = [];
	if (projection.httpPath) transports.push("http");
	if (projection.mcp) transports.push("mcp");
	if (projection.webmcp) transports.push("webmcp");
	return transports;
}
function serializeCapabilities(capabilities, access, options = {}) {
	return Promise.all(Object.entries(capabilities ?? {}).map(async ([name, file]) => {
		try {
			const capability = (await access.loadModule(file)).default;
			if (!capability || capability.kind !== "capability") throw new Error("module does not default-export a capability");
			const transports = [];
			if (capability.expose?.http) transports.push("http");
			if (capability.expose?.mcp) transports.push("mcp");
			if (capability.expose?.webmcp) transports.push("webmcp");
			return {
				agentPolicy: capability.agentPolicy ?? null,
				description: capability.description,
				effect: capability.effect,
				hasUi: false,
				httpPath: capability.expose?.http ? capability.expose.http.path ?? capabilityHttpPath(name) : null,
				input: capability.input ?? null,
				middleware: capability.middleware ?? [],
				name,
				output: capability.output ?? null,
				source: file,
				title: capability.title,
				transports
			};
		} catch (cause) {
			if (options.strict) {
				const detail = cause instanceof Error ? cause.message : String(cause);
				throw new Error(`Failed to load capability ${JSON.stringify(name)} from ${JSON.stringify(file)} while resolving the app graph: ${detail}`, { cause });
			}
			const projection = readProjection(name, file, access);
			const unverified = !projection || projection.agentPolicy === void 0 || projection.middleware === void 0;
			return {
				agentPolicy: projection?.agentPolicy ?? null,
				description: projection?.description ?? null,
				effect: projection?.effect ?? null,
				error: cause instanceof Error ? cause.message : String(cause),
				unverifiedContract: unverified ? true : void 0,
				hasUi: false,
				httpPath: projection?.httpPath ?? null,
				input: projection?.inputSchema ?? null,
				middleware: projection?.middleware ?? [],
				name,
				output: null,
				source: file,
				title: null,
				transports: projectionTransports(projection)
			};
		}
	}));
}
/** Whether the configured projection actually has a destructive MCP tool to serve. */
function servesDestructiveMcpTools(app, capabilities) {
	return app.agents?.mcp?.destructive === true && capabilities.some((capability) => capability.effect === "destructive" && capability.transports.includes("mcp"));
}
/**
* Server-only middleware modules whose top-level setup may satisfy destructive
* MCP preconditions. This mirrors the runtime endpoint: app API middleware and
* named middleware applied to a served destructive capability are startup
* inputs; unrelated registered middleware remains lazy.
*/
function destructiveMcpSetupMiddlewareFiles(app, capabilities) {
	if (!servesDestructiveMcpTools(app, capabilities)) return [];
	const names = new Set(app.api?.middleware ?? []);
	for (const capability of capabilities) {
		if (capability.effect !== "destructive" || !capability.transports.includes("mcp")) continue;
		for (const name of capability.middleware) names.add(name);
	}
	return [...names].flatMap((name) => {
		const file = app.middleware?.[name];
		return file ? [file] : [];
	});
}
async function buildAppGraph(options) {
	const notFound = options.app.notFound;
	const capabilities = await serializeCapabilities(options.app.capabilities, options);
	const mcpEndpoint = resolveMcpEndpoint(options.app.agents);
	const capabilityFailures = mcpEndpoint === null ? [] : capabilities.flatMap((capability) => capability.error ? [`Capability ${JSON.stringify(capability.name)} failed to load: ${capability.error}`] : []);
	const mcpDestructive = servesDestructiveMcpTools(options.app, capabilities);
	let verifierFailure = null;
	if (options.app.agents?.mcp?.auth && options.verifyMcpTokenVerifier) try {
		await options.verifyMcpTokenVerifier();
	} catch (error) {
		verifierFailure = `MCP token verifier failed to load: ${error instanceof Error ? error.message : String(error)}`;
	}
	let setupFailure = null;
	if (mcpDestructive && options.loadSetupModule) try {
		await Promise.all(destructiveMcpSetupMiddlewareFiles(options.app, capabilities).map(options.loadSetupModule));
	} catch (error) {
		setupFailure = `destructive MCP setup modules failed to load: ${error instanceof Error ? error.message : String(error)}`;
	}
	const mcpUnavailableReasons = [
		...capabilityFailures,
		...verifierFailure === null ? [] : [verifierFailure],
		...setupFailure !== null ? [setupFailure] : mcpDestructive ? destructiveMcpPreconditionErrors(options.app.agents) : []
	];
	return {
		api: await serializeApiRoutes(options.apiRoutes ?? [], options),
		capabilities,
		mcpEndpoint,
		mcpDestructive,
		mcpAuthenticated: !!options.app.agents?.mcp?.auth,
		mcpRuntimeStatus: mcpEndpoint === null ? "not-configured" : mcpUnavailableReasons.length > 0 ? "blocked" : "ready",
		mcpUnavailableReasons,
		notFound: notFound ? serializeAppRoutes([notFound])[0] : null,
		routes: serializeAppRoutes(options.app.routes)
	};
}
async function detectApiExports(file, access) {
	try {
		return apiExportsFromModule(await access.loadModule(file));
	} catch {
		let source;
		try {
			source = access.readSource(file);
		} catch {
			return {
				hasDefaultHandler: false,
				methods: []
			};
		}
		const maskedSource = maskJavaScriptCommentsAndStrings(source);
		const topLevelOffsets = findTopLevelOffsets(maskedSource);
		return {
			hasDefaultHandler: hasStaticallyCallableDefaultExport(maskedSource, topLevelOffsets),
			methods: API_METHOD_ORDER.filter((method) => hasTopLevelMatch(maskedSource, new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${method}\\b`, "g"), topLevelOffsets))
		};
	}
}
function apiExportsFromModule(module) {
	return {
		hasDefaultHandler: typeof module.default === "function",
		methods: API_METHOD_ORDER.filter((method) => typeof module[method] === "function")
	};
}
/** Detect API exports from source text only, following relative star re-exports. */
async function detectApiExportsStatic(file, access, seen = /* @__PURE__ */ new Set()) {
	if (seen.has(file)) return {
		hasDefaultHandler: false,
		methods: []
	};
	seen.add(file);
	let rawSource;
	try {
		rawSource = access.readSource(file);
	} catch {
		return {
			hasDefaultHandler: false,
			methods: []
		};
	}
	const source = maskJavaScriptCommentsAndStrings(rawSource);
	const topLevelOffsets = findTopLevelOffsets(source);
	const exportedNames = /* @__PURE__ */ new Set();
	const hasDefaultHandler = hasStaticallyCallableDefaultExport(source, topLevelOffsets);
	for (const method of API_METHOD_ORDER) if (hasTopLevelMatch(source, new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${method}\\b`, "g"), topLevelOffsets)) exportedNames.add(method);
	for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}(?:\s*from\s*["'][^"']+["'])?/g)) {
		if (!topLevelOffsets[match.index ?? 0]) continue;
		for (const entry of match[1].split(",")) {
			const normalized = entry.trim();
			if (!normalized) continue;
			if (/^type\s+/.test(normalized)) continue;
			const parts = normalized.split(/\s+as\s+/);
			const exportedName = (parts[1] ?? parts[0]).trim();
			if (exportedName !== "default") exportedNames.add(exportedName);
		}
	}
	if (access.resolveModule) for (const match of source.matchAll(/\bexport\s*\*\s*from\s*(["'])/g)) {
		if (!topLevelOffsets[match.index ?? 0]) continue;
		const quoteIndex = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
		const specifier = readStringLiteral(rawSource, quoteIndex);
		if (!specifier) continue;
		const resolved = await access.resolveModule(specifier, file);
		if (!resolved) continue;
		const nested = await detectApiExportsStatic(resolved, access, seen);
		for (const method of nested.methods) exportedNames.add(method);
	}
	return {
		hasDefaultHandler,
		methods: API_METHOD_ORDER.filter((method) => exportedNames.has(method))
	};
}
/** Recognize default handlers whose callable value is evident from local syntax. */
function hasStaticallyCallableDefaultExport(source, topLevelOffsets = findTopLevelOffsets(source)) {
	for (const pattern of [/\bexport\s+default\s+(?:async\s+)?function(?:\s*\*)?(?:\s+[A-Za-z_$][\w$]*)?\s*\(/g, /\bexport\s+default\s+(?:async\s+)?(?:[A-Za-z_$][\w$]*|\([^;{}]*\))\s*=>/g]) if (hasTopLevelMatch(source, pattern, topLevelOffsets)) return true;
	const callableBindings = /* @__PURE__ */ new Set();
	for (const match of source.matchAll(/\b(?:async\s+)?function(?:\s*\*)?\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
		if (!isModuleFunctionDeclaration(source, match.index ?? 0, topLevelOffsets) || previousWord(source, match.index ?? 0) === "declare") continue;
		callableBindings.add(match[1]);
	}
	for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;]+)?\s*=\s*(?:async\s+)?function\b/g)) {
		if (!topLevelOffsets[match.index ?? 0]) continue;
		callableBindings.add(match[1]);
	}
	for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;]+)?\s*=\s*(?:async\s+)?(?:[A-Za-z_$][\w$]*|\([^;{}]*\))\s*=>/g)) {
		if (!topLevelOffsets[match.index ?? 0]) continue;
		callableBindings.add(match[1]);
	}
	for (const match of source.matchAll(/\bexport\s+default\s+([A-Za-z_$][\w$]*)(?=[ \t]*(?:;|\r?\n|$))/g)) if (topLevelOffsets[match.index ?? 0] && callableBindings.has(match[1])) return true;
	for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}(\s*from\s*["'][^"']*["'])?/g)) {
		if (!topLevelOffsets[match.index ?? 0] || match[2]) continue;
		for (const entry of match[1].split(",")) {
			const normalized = entry.trim();
			if (!normalized || /^type\s+/.test(normalized)) continue;
			const parts = normalized.split(/\s+as\s+/);
			const localName = parts[0].trim();
			if ((parts[1] ?? parts[0]).trim() === "default" && callableBindings.has(localName)) return true;
		}
	}
	return false;
}
/** Mark offsets whose token starts in module scope rather than inside nested syntax. */
function findTopLevelOffsets(source) {
	const offsets = new Uint8Array(source.length + 1);
	let nestingDepth = 0;
	for (let index = 0; index < source.length; index += 1) {
		offsets[index] = nestingDepth === 0 ? 1 : 0;
		if (source[index] === "{" || source[index] === "(" || source[index] === "[") nestingDepth += 1;
		else if (source[index] === "}" || source[index] === ")" || source[index] === "]") nestingDepth = Math.max(0, nestingDepth - 1);
	}
	offsets[source.length] = nestingDepth === 0 ? 1 : 0;
	return offsets;
}
function hasTopLevelMatch(source, pattern, topLevelOffsets) {
	for (const match of source.matchAll(pattern)) if (topLevelOffsets[match.index ?? 0]) return true;
	return false;
}
function previousWord(source, offset) {
	return /([A-Za-z_$][\w$]*)\s*$/.exec(source.slice(0, offset))?.[1] ?? null;
}
const MODULE_EXPRESSION_PREFIX_KEYWORDS = new Set([
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
]);
/** Distinguish a module declaration from a same-depth named function expression. */
function isModuleFunctionDeclaration(source, offset, topLevelOffsets) {
	if (!topLevelOffsets[offset]) return false;
	const prefix = source.slice(0, offset);
	const trimmed = prefix.trimEnd();
	if (!trimmed || /[;}]$/.test(trimmed)) return true;
	const word = previousWord(source, offset);
	if (word === "export" || word === "default" || word === "declare") return true;
	const whitespace = prefix.slice(trimmed.length);
	if (!/[\r\n]/.test(whitespace)) return false;
	if (/[([{=,:!?&|+\-*%^~<>.]$/.test(trimmed) || /=>\s*$/.test(trimmed)) return false;
	return !MODULE_EXPRESSION_PREFIX_KEYWORDS.has(word ?? "");
}
/** Mask comments and string contents while preserving offsets and syntax punctuation. */
function maskJavaScriptCommentsAndStrings(source) {
	let result = "";
	let index = 0;
	let quote = null;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (quote) {
			if (char === "\\") {
				result += " ";
				result += next === "\n" ? "\n" : next ? " " : "";
				index += 2;
				continue;
			}
			if (char === quote) {
				result += char;
				quote = null;
			} else result += char === "\n" ? "\n" : " ";
			index += 1;
			continue;
		}
		if (char === "\"" || char === "'" || char === "`") {
			quote = char;
			result += char;
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			result += "  ";
			index += 2;
			while (index < source.length && source[index] !== "\n") {
				result += " ";
				index += 1;
			}
			continue;
		}
		if (char === "/" && next === "*") {
			result += "  ";
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
				result += source[index] === "\n" ? "\n" : " ";
				index += 1;
			}
			if (index < source.length) {
				result += "  ";
				index += 2;
			}
			continue;
		}
		if (char === "/" && canStartRegexLiteral(result)) {
			const regexEnd = findRegexLiteralEnd(source, index);
			if (regexEnd !== null) {
				while (index < regexEnd) {
					result += source[index] === "\n" ? "\n" : " ";
					index += 1;
				}
				continue;
			}
		}
		result += char;
		index += 1;
	}
	return result;
}
const REGEX_PREFIX_KEYWORDS = new Set([
	"await",
	"case",
	"delete",
	"default",
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
]);
const REGEX_CONTROL_KEYWORDS = new Set([
	"for",
	"if",
	"while",
	"with"
]);
/** Decide whether `/` starts an expression rather than dividing one. */
function canStartRegexLiteral(maskedPrefix) {
	const prefix = maskedPrefix.trimEnd();
	if (!prefix) return true;
	if (prefix.endsWith("++") || prefix.endsWith("--")) return false;
	const previous = prefix.at(-1) ?? "";
	if ("([{=,:;!?&|+-*%^~<>}".includes(previous)) return true;
	if (previous === ")" && followsControlCondition(prefix)) return true;
	const previousWord = /([A-Za-z_$][\w$]*)$/.exec(prefix)?.[1];
	return previousWord ? REGEX_PREFIX_KEYWORDS.has(previousWord) : false;
}
/** A regex may be the single statement following `if (...)`, `for (...)`, etc. */
function followsControlCondition(prefix) {
	let depth = 0;
	for (let index = prefix.length - 1; index >= 0; index -= 1) {
		const char = prefix[index];
		if (char === ")") {
			depth += 1;
			continue;
		}
		if (char !== "(") continue;
		depth -= 1;
		if (depth !== 0) continue;
		const controlPrefix = prefix.slice(0, index).trimEnd();
		const keyword = /([A-Za-z_$][\w$]*)$/.exec(controlPrefix)?.[1];
		return keyword ? REGEX_CONTROL_KEYWORDS.has(keyword) : false;
	}
	return false;
}
/** Return the offset after a complete regex literal and its flags. */
function findRegexLiteralEnd(source, start) {
	let inCharacterClass = false;
	for (let index = start + 1; index < source.length; index += 1) {
		const char = source[index];
		if (char === "\n" || char === "\r") return null;
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "[") {
			inCharacterClass = true;
			continue;
		}
		if (char === "]") {
			inCharacterClass = false;
			continue;
		}
		if (char !== "/" || inCharacterClass) continue;
		let end = index + 1;
		while (/[A-Za-z]/.test(source[end] ?? "")) end += 1;
		return end;
	}
	return null;
}
function readStringLiteral(source, quoteIndex) {
	const quote = source[quoteIndex];
	if (quote !== "\"" && quote !== "'") return null;
	let value = "";
	for (let index = quoteIndex + 1; index < source.length; index += 1) {
		const char = source[index];
		if (char === quote) return value;
		if (char === "\\") {
			const escaped = source[index + 1];
			if (escaped === void 0) return null;
			value += escaped;
			index += 1;
			continue;
		}
		if (char === "\n" || char === "\r") return null;
		value += char;
	}
	return null;
}
async function detectApiMethods(file, access) {
	return (await detectApiExports(file, access)).methods;
}
//#endregion
export { API_METHOD_ORDER, buildAppGraph, destructiveMcpSetupMiddlewareFiles, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities, servesDestructiveMcpTools };
