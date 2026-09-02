import { C as isValidCapabilityHttpPath, x as capabilityHttpPath } from "./protocol-Ck3OUbxD.mjs";
//#region src/static.ts
/**
* Static analysis of capability sources — shared by the Vite plugin (client
* projection codegen) and the CLI (`pracht verify`, `pracht typegen`). Every
* consumer parses the same `defineCapability({ ... })` call sites without
* executing application code, so keeping the parser here guarantees the build,
* verification, and type generation can never disagree about what is
* statically analyzable.
*
* Constraint this imposes on capability authors: values the tools need
* (`expose`, `effect`, `input`, string fields) must be inline literals — no
* imported constants or spreads. `evaluateLiteral()` parses the literal text
* as data and returns `undefined` for anything else.
*/
/**
* Derive a capability's projection from its source, without executing it.
*
* This is the single implementation behind three consumers that must agree:
* the Vite plugin builds the browser endpoint table from it, `pracht verify`
* checks the contract against it, and `pracht typegen` cross-checks it against
* the executed graph. If they disagreed, generated types could promise an
* endpoint the client bundle never registered.
*
* `name` supplies the default HTTP path; `describe` wraps error messages so
* each caller can phrase them its own way (the plugin fails the build, the CLI
* fails a check).
*/
function extractCapabilityProjection(name, source, describe) {
	const args = extractDefineCapabilityArgs(source);
	if (!args) throw new Error(describe("does not contain a defineCapability({ ... }) call the build can analyze."));
	const { properties, truncated } = scanTopLevelPropertyEntries(args);
	const exposeText = properties.get("expose");
	if (!exposeText && truncated) throw new Error(describe("contains a spread or computed key the build cannot analyze, so its `expose` could not be read. Declare `expose`, `effect`, `agentPolicy`, and `middleware` as inline literals."));
	if (!exposeText) return {
		title: "",
		description: "",
		effect: null,
		httpPath: null,
		webmcp: false,
		webmcpUntrustedContent: false,
		inputSchema: null,
		mcp: false,
		...readGuardProperties(properties, truncated)
	};
	const expose = evaluateLiteral(exposeText);
	if (!isPlainObject(expose)) throw new Error(describe("\"expose\" must be an inline object literal so the client projection can be generated at build time."));
	const http = expose.http;
	let httpPath = null;
	if (http === true) httpPath = capabilityHttpPath(name);
	else if (isPlainObject(http)) httpPath = typeof http.path === "string" ? http.path : capabilityHttpPath(name);
	if (httpPath && !isValidCapabilityHttpPath(httpPath)) throw new Error(describe("HTTP exposure \"path\" must be an exact same-origin pathname starting with \"/\"."));
	let webmcp = false;
	let webmcpUntrustedContent = false;
	if (expose.webmcp === true) webmcp = true;
	else if (isPlainObject(expose.webmcp)) {
		webmcp = true;
		webmcpUntrustedContent = expose.webmcp.untrustedContent === true;
	} else if (expose.webmcp !== void 0 && expose.webmcp !== false && expose.webmcp !== null) throw new Error(describe("\"expose.webmcp\" must be a boolean or an options object."));
	if (webmcp && !httpPath) throw new Error(describe("expose.webmcp requires expose.http."));
	let title = "";
	const titleText = properties.get("title");
	if (titleText) {
		const value = evaluateLiteral(titleText);
		if (typeof value === "string") title = value;
	}
	let description = "";
	const descriptionText = properties.get("description");
	if (descriptionText) {
		const value = evaluateLiteral(descriptionText);
		if (typeof value === "string") description = value;
	}
	let effect = null;
	const effectText = properties.get("effect");
	if (effectText) {
		const value = evaluateLiteral(effectText);
		if (typeof value === "string") effect = value;
	}
	if (httpPath && effect !== "read" && effect !== "write" && effect !== "destructive") throw new Error(describe("is exposed via HTTP, but its \"effect\" could not be extracted at build time. HTTP-exposed capabilities must declare \"effect\" as an inline \"read\", \"write\", or \"destructive\" string literal."));
	let inputSchema = null;
	if (webmcp) {
		const inputText = properties.get("input");
		const value = inputText ? evaluateLiteral(inputText) : void 0;
		if (!isPlainObject(value)) throw new Error(describe("is exposed via WebMCP, but its \"input\" schema could not be extracted at build time. WebMCP-exposed capabilities must declare their input schema as an inline object literal."));
		inputSchema = value;
	}
	return {
		title,
		description,
		effect,
		httpPath,
		webmcp,
		webmcpUntrustedContent,
		inputSchema,
		mcp: expose.mcp === true,
		...readGuardProperties(properties, truncated)
	};
}
/**
* Recover the guard-shaped fields — the ones a reviewer reads to decide whether
* a change widened what agents can reach.
*
* Each is `undefined` when it is declared but not as a literal this pass can
* evaluate, so a caller can say "unverifiable" rather than "absent". `null`
* `agentPolicy` and `[]` middleware are real answers meaning "not declared".
*/
function readGuardProperties(properties, truncated) {
	if (truncated) return {
		agentPolicy: void 0,
		middleware: void 0
	};
	const policyText = properties.get("agentPolicy");
	let agentPolicy = null;
	if (policyText) {
		const value = evaluateLiteral(policyText);
		agentPolicy = typeof value === "string" ? value : void 0;
	}
	const middlewareText = properties.get("middleware");
	let middleware = [];
	if (middlewareText) {
		const value = evaluateLiteral(middlewareText);
		middleware = Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : void 0;
	}
	return {
		agentPolicy,
		middleware
	};
}
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Extract the argument object text of the *default-exported*
* `defineCapability({ ... })` call. The runtime resolves a capability module
* by its default export, so analysis must agree: a helper `defineCapability()`
* call earlier in the file must not be mistaken for the exported one. Matches
* the call site (optionally with a type argument), not the import binding.
*/
function extractDefineCapabilityArgs(source) {
	const searchable = maskCommentsAndStrings(source);
	const parenIndex = findDefaultExportedCallParen(searchable);
	if (parenIndex === -1) return null;
	const braceStart = searchable.indexOf("{", parenIndex);
	if (braceStart === -1) return null;
	const braceEnd = findMatchingBrace(source, braceStart, "{", "}");
	if (braceEnd === -1) return null;
	return source.slice(braceStart + 1, braceEnd);
}
const CALL_SITE = /defineCapability\s*(?:<[^(]*?>)?\s*\(/g;
/**
* Index of the `(` of the default-exported `defineCapability()` call, or -1
* when the module has no analyzable default-exported call. Handles
* `export default defineCapability(...)`, `export default <id>` (with or
* without a trailing `;`), and `export { <id> as default }`, resolving the
* identifier to its `const/let/var <id> = defineCapability(...)` declaration.
* A named-only call is deliberately not accepted: the runtime requires the
* capability itself to be the module's default export.
*/
function findDefaultExportedCallParen(searchable) {
	const direct = /export\s+default\s+defineCapability\s*(?:<[^(]*?>)?\s*\(/.exec(searchable);
	if (direct && direct.index != null) return direct.index + direct[0].length - 1;
	const localName = defaultExportLocalName(searchable);
	if (localName) {
		const id = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const decl = new RegExp(`\\b(?:const|let|var)\\s+${id}\\b`, "g");
		for (const match of searchable.matchAll(decl)) if (match.index != null && braceDepthAt(searchable, match.index) === 0) {
			const paren = findDefineCapabilityInitializer(searchable, match.index + match[0].length);
			if (paren !== -1) return paren;
		}
	}
	return -1;
}
/**
* Resolve the first assignment of a variable declaration and accept it only
* when its initializer is immediately `defineCapability(...)`. This avoids
* crossing an ASI boundary into a later declaration while still supporting
* multiline and arrow-function type annotations.
*/
function findDefineCapabilityInitializer(searchable, start) {
	return findCallInitializer(searchable, start, "defineCapability", CALL_SITE.source);
}
function findCallInitializer(searchable, start, callName, callPattern = `${callName}\\s*(?:<[^(]*?>)?\\s*\\(`) {
	let depth = 0;
	for (let index = start; index < searchable.length; index += 1) {
		const char = searchable[index];
		if (char === "(" || char === "[" || char === "{") {
			depth += 1;
			continue;
		}
		if (char === ")" || char === "]" || char === "}") {
			if (depth === 0) return -1;
			depth -= 1;
			continue;
		}
		if (depth !== 0) continue;
		if (char === ";") return -1;
		if (char === "\n" || char === "\r") {
			const next = searchable.slice(skipWhitespace(searchable, index + 1));
			if (/^(?:(?:export|import)\b|(?:const|let|var|function|class)\b)/.test(next)) return -1;
			continue;
		}
		if (char === "=" && searchable[index + 1] !== ">" && searchable[index - 1] !== "=" && searchable[index - 1] !== "!" && searchable[index - 1] !== "<" && searchable[index - 1] !== ">") {
			const initializerStart = skipWhitespace(searchable, index + 1);
			const call = new RegExp(`^${callPattern}`).exec(searchable.slice(initializerStart));
			return call ? initializerStart + call[0].length - 1 : -1;
		}
	}
	return -1;
}
function skipWhitespace(source, start) {
	let index = start;
	while (index < source.length && /\s/.test(source[index])) index += 1;
	return index;
}
/**
* Brace/paren/bracket nesting depth at `index` in an already comment- and
* string-masked source. Depth 0 means module scope.
*/
function braceDepthAt(searchable, index) {
	let depth = 0;
	for (let cursor = 0; cursor < index; cursor += 1) {
		const char = searchable[cursor];
		if (char === "{" || char === "(" || char === "[") depth += 1;
		else if (char === "}" || char === ")" || char === "]") depth -= 1;
	}
	return depth;
}
/** Local binding name of a module's default export, or null. */
function defaultExportLocalName(searchable) {
	const idMatch = /export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/.exec(searchable);
	if (idMatch && idMatch[1] !== "defineCapability") return idMatch[1];
	const asDefault = /export\s*\{[^}]*?\b([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+default\b/.exec(searchable);
	return asDefault ? asDefault[1] : null;
}
function scanTopLevelProperties(objectBody) {
	return scanTopLevelPropertyEntries(objectBody).properties;
}
function scanTopLevelPropertyEntries(objectBody) {
	const properties = /* @__PURE__ */ new Map();
	let index = 0;
	let truncated = false;
	while (index < objectBody.length) {
		index = skipInsignificant(objectBody, index);
		if (index >= objectBody.length) break;
		let key = null;
		const char = objectBody[index];
		if (char === "\"" || char === "'") {
			const end = findStringEnd(objectBody, index);
			if (end === -1) {
				truncated = true;
				break;
			}
			const decoded = evaluateLiteral(objectBody.slice(index, end + 1));
			if (typeof decoded !== "string") {
				truncated = true;
				break;
			}
			key = decoded;
			index = end + 1;
		} else {
			const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(objectBody.slice(index));
			if (!match) {
				truncated = true;
				break;
			}
			key = match[0];
			index += match[0].length;
		}
		index = skipInsignificant(objectBody, index);
		if (objectBody[index] !== ":") {
			index = skipToTopLevelComma(objectBody, index) + 1;
			continue;
		}
		index += 1;
		const valueStart = skipInsignificant(objectBody, index);
		const valueEnd = skipToTopLevelComma(objectBody, valueStart);
		properties.set(key, objectBody.slice(valueStart, valueEnd).trim());
		index = valueEnd + 1;
	}
	return {
		properties,
		truncated
	};
}
/** Parse the `capabilities: { ... }` block of an app manifest source. */
function extractCapabilityRegistrations(manifestSource) {
	const appBody = extractDefineAppObjectBody(manifestSource);
	if (!appBody) return [];
	const capabilitiesValue = scanTopLevelProperties(appBody).get("capabilities");
	if (!capabilitiesValue) return [];
	const braceStart = skipInsignificant(capabilitiesValue, 0);
	if (capabilitiesValue[braceStart] !== "{") return [];
	const braceEnd = findMatchingBrace(capabilitiesValue, braceStart, "{", "}");
	if (braceEnd === -1) return [];
	const searchableBlock = maskComments(capabilitiesValue.slice(braceStart + 1, braceEnd));
	const entries = [];
	for (const match of searchableBlock.matchAll(/(?:(["'])((?:\\.|(?!\1).)+)\1|([A-Za-z0-9_$]+))\s*:\s*(?:\(\)\s*=>\s*import\(\s*(["'])([^"']+)\4\s*\)|(["'])([^"']+)\6)/g)) entries.push({
		name: match[2] ?? match[3],
		file: match[5] ?? match[7]
	});
	return entries;
}
/** Extract the inline object body passed to the exported app's `defineApp()`. */
function extractDefineAppObjectBody(source) {
	const searchable = maskCommentsAndStrings(source);
	const defaultExport = /export\s+default\s+defineApp\s*(?:<[^(]*?>)?\s*\(/.exec(searchable);
	let parenIndex = defaultExport?.index != null ? defaultExport.index + defaultExport[0].length - 1 : -1;
	if (parenIndex === -1) for (const match of searchable.matchAll(/export\s+(?:const|let|var)\s+app\b/g)) {
		if (match.index == null || braceDepthAt(searchable, match.index) !== 0) continue;
		parenIndex = findCallInitializer(searchable, match.index + match[0].length, "defineApp");
		if (parenIndex !== -1) break;
	}
	if (parenIndex === -1) {
		const localName = namedAppExportLocalName(searchable);
		if (localName) {
			const id = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const declaration = new RegExp(`\\b(?:const|let|var)\\s+${id}\\b`, "g");
			for (const match of searchable.matchAll(declaration)) {
				if (match.index == null || braceDepthAt(searchable, match.index) !== 0) continue;
				parenIndex = findCallInitializer(searchable, match.index + match[0].length, "defineApp");
				if (parenIndex !== -1) break;
			}
		}
	}
	if (parenIndex === -1) return null;
	const braceStart = skipInsignificant(source, parenIndex + 1);
	if (source[braceStart] !== "{") return null;
	const braceEnd = findMatchingBrace(source, braceStart, "{", "}");
	return braceEnd === -1 ? null : source.slice(braceStart + 1, braceEnd);
}
function namedAppExportLocalName(searchable) {
	const aliased = /export\s*\{[^}]*?\b([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+app\b/.exec(searchable);
	if (aliased) return aliased[1];
	return /export\s*\{[^}]*?\bapp\b(?:\s*,|\s*\})/.test(searchable) ? "app" : null;
}
/**
* Find the raw text of a top-level-ish `key: { ... }` property anywhere in a
* source file (used for the manifest's `capabilities` block).
*/
function findTopLevelObjectProperty(source, key) {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const codeOnly = maskCommentsAndStrings(source);
	const commentsRemoved = maskComments(source);
	const unquotedMatch = new RegExp(`\\b${escapedKey}\\s*:\\s*\\{`).exec(codeOnly);
	const quotedIndex = findQuotedObjectProperty(source, key);
	const matchIndex = [unquotedMatch?.index, quotedIndex].filter((candidate) => candidate !== void 0 && candidate !== null).sort((left, right) => left - right)[0];
	if (matchIndex === void 0) return null;
	const braceStart = commentsRemoved.indexOf("{", matchIndex);
	const braceEnd = findMatchingBrace(source, braceStart, "{", "}");
	if (braceEnd === -1) return null;
	return source.slice(braceStart + 1, braceEnd);
}
/** Parse an extracted data literal without evaluating application code. */
function evaluateLiteral(expression) {
	const parsed = parseLiteralValue(expression, 0);
	if (!parsed) return void 0;
	return skipInsignificant(expression, parsed.index) === expression.length ? parsed.value : void 0;
}
function skipToTopLevelComma(source, start) {
	let depth = 0;
	let index = start;
	while (index < source.length) {
		const char = source[index];
		if (char === "\"" || char === "'" || char === "`") {
			const end = findStringEnd(source, index);
			if (end === -1) return source.length;
			index = end + 1;
			continue;
		}
		if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipInsignificant(source, index);
			continue;
		}
		if (char === "/") {
			const regexEnd = regexLiteralEnd(source, index);
			if (regexEnd !== -1) {
				index = regexEnd;
				continue;
			}
		}
		if (char === "{" || char === "[" || char === "(") depth += 1;
		if (char === "}" || char === "]" || char === ")") depth -= 1;
		if (char === "," && depth === 0) return index;
		index += 1;
	}
	return source.length;
}
function skipInsignificant(source, start) {
	let index = start;
	while (index < source.length) {
		const char = source[index];
		if (char === " " || char === "	" || char === "\n" || char === "\r") {
			index += 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "/") {
			const lineEnd = source.indexOf("\n", index);
			index = lineEnd === -1 ? source.length : lineEnd + 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			const blockEnd = source.indexOf("*/", index + 2);
			index = blockEnd === -1 ? source.length : blockEnd + 2;
			continue;
		}
		break;
	}
	return index;
}
/**
* Replace comments, regex literals, and optionally strings with spaces while
* preserving source offsets. Regex-based entry-point discovery can then only
* match live code, while the real source remains available for brace-aware
* extraction.
*/
function maskLexicalNoise(source, maskStrings) {
	const chars = source.split("");
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		if (char === "\"" || char === "'" || char === "`") {
			const end = findStringEnd(source, index);
			if (end === -1) return chars.slice(0, index).join("") + " ".repeat(source.length - index);
			if (maskStrings) {
				for (let cursor = index; cursor <= end; cursor += 1) if (chars[cursor] !== "\n" && chars[cursor] !== "\r") chars[cursor] = " ";
			}
			index = end + 1;
			continue;
		}
		if (char === "/" && source[index + 1] === "/") {
			const end = source.indexOf("\n", index + 2);
			const limit = end === -1 ? source.length : end;
			for (let cursor = index; cursor < limit; cursor += 1) chars[cursor] = " ";
			index = limit;
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			const close = source.indexOf("*/", index + 2);
			const limit = close === -1 ? source.length : close + 2;
			for (let cursor = index; cursor < limit; cursor += 1) if (chars[cursor] !== "\n" && chars[cursor] !== "\r") chars[cursor] = " ";
			index = limit;
			continue;
		}
		if (char === "/") {
			const end = regexLiteralEnd(source, index);
			if (end !== -1) {
				for (let cursor = index; cursor < end; cursor += 1) if (chars[cursor] !== "\n" && chars[cursor] !== "\r") chars[cursor] = " ";
				index = end;
				continue;
			}
		}
		index += 1;
	}
	return chars.join("");
}
function maskComments(source) {
	return maskLexicalNoise(source, false);
}
function maskCommentsAndStrings(source) {
	return maskLexicalNoise(source, true);
}
/** Find an actual quoted property token, excluding lookalikes inside strings/comments. */
function findQuotedObjectProperty(source, key) {
	let index = 0;
	while (index < source.length) {
		const next = skipInsignificant(source, index);
		if (next > index) {
			index = next;
			continue;
		}
		const char = source[index];
		if (char !== "\"" && char !== "'" && char !== "`") {
			index += 1;
			continue;
		}
		const end = findStringEnd(source, index);
		if (end === -1) return null;
		if (char !== "`" && source.slice(index + 1, end) === key) {
			const colon = skipInsignificant(source, end + 1);
			const brace = source[colon] === ":" ? skipInsignificant(source, colon + 1) : -1;
			if (brace !== -1 && source[brace] === "{") return index;
		}
		index = end + 1;
	}
	return null;
}
/** Index of the closing quote of the string starting at `start`. */
function findStringEnd(source, start) {
	const quote = source[start];
	if (quote === "`") return findTemplateEnd(source, start);
	for (let index = start + 1; index < source.length; index += 1) {
		const char = source[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === quote) return index;
	}
	return -1;
}
/**
* Index of the closing backtick of the template literal starting at `start`.
* Tracks `${ ... }` interpolations (including nested strings and templates
* inside them) so an inner backtick or `}` does not end the template early.
*/
function findTemplateEnd(source, start) {
	for (let index = start + 1; index < source.length; index += 1) {
		const char = source[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "`") return index;
		if (char === "$" && source[index + 1] === "{") {
			let depth = 1;
			index += 2;
			while (index < source.length && depth > 0) {
				const inner = source[index];
				if (inner === "\\") {
					index += 2;
					continue;
				}
				if (inner === "\"" || inner === "'" || inner === "`") {
					const end = findStringEnd(source, index);
					if (end === -1) return -1;
					index = end + 1;
					continue;
				}
				if (inner === "{") depth += 1;
				else if (inner === "}") depth -= 1;
				index += 1;
			}
			if (depth > 0) return -1;
			index -= 1;
		}
	}
	return -1;
}
function findMatchingBrace(source, start, open, close) {
	let depth = 0;
	for (let index = start; index < source.length; index += 1) {
		const char = source[index];
		if (char === "\"" || char === "'" || char === "`") {
			const end = findStringEnd(source, index);
			if (end === -1) return -1;
			index = end;
			continue;
		}
		if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipInsignificant(source, index) - 1;
			continue;
		}
		if (char === "/") {
			const regexEnd = regexLiteralEnd(source, index);
			if (regexEnd !== -1) {
				index = regexEnd - 1;
				continue;
			}
		}
		if (char === open) depth += 1;
		if (char === close) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}
const REGEX_PRECEDING_PUNCTUATION = new Set([
	"(",
	",",
	"=",
	":",
	"[",
	"!",
	"&",
	"|",
	"?",
	"{",
	"}",
	";",
	"<",
	">",
	"+",
	"-",
	"*",
	"%",
	"^",
	"~"
]);
const REGEX_PRECEDING_KEYWORDS = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"do",
	"else",
	"yield",
	"await",
	"case"
]);
const REGEX_STATEMENT_CONTROL_KEYWORDS = new Set([
	"if",
	"while",
	"for",
	"with"
]);
/**
* Whether `closeIndex` closes a control-flow condition whose body may begin
* with a regex expression statement (`if (condition) /pattern/.test(value)`).
*
* A closing parenthesis normally makes the following slash division. Control
* statements are the exception, so retain just enough token context while
* matching parentheses to distinguish them from calls such as `fn() / 2`.
*/
function closesRegexStatementControlParen(source, closeIndex) {
	const controlParens = [];
	const tokens = [];
	const record = (token) => {
		tokens.push(token);
		if (tokens.length > 2) tokens.shift();
	};
	for (let index = 0; index <= closeIndex; index += 1) {
		const char = source[index];
		if (/\s/.test(char)) continue;
		if (char === "\"" || char === "'" || char === "`") {
			const end = findStringEnd(source, index);
			if (end === -1) return false;
			record({
				kind: "atom",
				value: "string"
			});
			index = end;
			continue;
		}
		if (char === "/" && source[index + 1] === "/") {
			const end = source.indexOf("\n", index + 2);
			index = end === -1 ? source.length : end;
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			const end = source.indexOf("*/", index + 2);
			if (end === -1) return false;
			index = end + 1;
			continue;
		}
		if (char === "/") {
			const end = regexLiteralEnd(source, index);
			if (end !== -1) {
				record({
					kind: "atom",
					value: "regex"
				});
				index = end - 1;
				continue;
			}
			record({
				kind: "punctuation",
				value: char
			});
			continue;
		}
		if (/[A-Za-z_$]/.test(char)) {
			let end = index + 1;
			while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
			record({
				kind: "word",
				value: source.slice(index, end)
			});
			index = end - 1;
			continue;
		}
		if (/[0-9]/.test(char)) {
			let end = index + 1;
			while (end < source.length && /[A-Za-z0-9_.]/.test(source[end])) end += 1;
			record({
				kind: "atom",
				value: source.slice(index, end)
			});
			index = end - 1;
			continue;
		}
		if (char === "(") {
			const previous = tokens[tokens.length - 1];
			const beforePrevious = tokens[tokens.length - 2];
			const followsControlKeyword = previous?.kind === "word" && (REGEX_STATEMENT_CONTROL_KEYWORDS.has(previous.value) || previous.value === "await" && beforePrevious?.kind === "word" && beforePrevious.value === "for") && beforePrevious?.value !== ".";
			controlParens.push(followsControlKeyword);
			record({
				kind: "punctuation",
				value: char
			});
			continue;
		}
		if (char === ")") {
			const closesControl = controlParens.pop() ?? false;
			if (index === closeIndex) return closesControl;
			record({
				kind: "punctuation",
				value: char
			});
			continue;
		}
		record({
			kind: "punctuation",
			value: char
		});
	}
	return false;
}
/**
* If the `/` at `slashIndex` begins a regex literal (decided from the previous
* significant token, the standard divide-vs-regex heuristic), return the index
* just after its closing `/` and flags; otherwise -1. Keeps the brace/comma
* scanners from miscounting a `}`/`]`/`,` inside a regex such as `/\}/`.
*/
function regexLiteralEnd(source, slashIndex) {
	let back = slashIndex - 1;
	while (back >= 0 && /\s/.test(source[back])) back -= 1;
	let isRegex;
	if (back < 0) isRegex = true;
	else {
		const prev = source[back];
		if (REGEX_PRECEDING_PUNCTUATION.has(prev)) isRegex = true;
		else if (prev === ")" && closesRegexStatementControlParen(source, back)) isRegex = true;
		else if (/[A-Za-z0-9_$]/.test(prev)) {
			let wordStart = back;
			while (wordStart >= 0 && /[A-Za-z0-9_$]/.test(source[wordStart])) wordStart -= 1;
			isRegex = REGEX_PRECEDING_KEYWORDS.has(source.slice(wordStart + 1, back + 1));
		} else isRegex = false;
	}
	if (!isRegex) return -1;
	let index = slashIndex + 1;
	let inClass = false;
	while (index < source.length) {
		const char = source[index];
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === "\n") return -1;
		if (char === "[") inClass = true;
		else if (char === "]") inClass = false;
		else if (char === "/" && !inClass) {
			index += 1;
			while (index < source.length && /[a-z]/i.test(source[index])) index += 1;
			return index;
		}
		index += 1;
	}
	return -1;
}
function parseLiteralValue(source, start) {
	const index = skipInsignificant(source, start);
	const char = source[index];
	if (char === "{") return parseObjectLiteral(source, index);
	if (char === "[") return parseArrayLiteral(source, index);
	if (char === "\"" || char === "'" || char === "`") return parseStringLiteral(source, index);
	if (source.startsWith("true", index)) return parseKeyword(source, index, "true", true);
	if (source.startsWith("false", index)) return parseKeyword(source, index, "false", false);
	if (source.startsWith("null", index)) return parseKeyword(source, index, "null", null);
	return parseNumberLiteral(source, index);
}
function parseObjectLiteral(source, start) {
	const value = {};
	let index = skipInsignificant(source, start + 1);
	if (source[index] === "}") return {
		value,
		index: index + 1
	};
	while (index < source.length) {
		let key = null;
		const char = source[index];
		if (char === "\"" || char === "'" || char === "`") {
			const parsedKey = parseStringLiteral(source, index);
			if (!parsedKey || typeof parsedKey.value !== "string") return null;
			key = parsedKey.value;
			index = parsedKey.index;
		} else {
			const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
			if (!match) return null;
			key = match[0];
			index += match[0].length;
		}
		index = skipInsignificant(source, index);
		if (source[index] !== ":") return null;
		const parsedValue = parseLiteralValue(source, index + 1);
		if (!parsedValue) return null;
		value[key] = parsedValue.value;
		index = skipInsignificant(source, parsedValue.index);
		if (source[index] === "}") return {
			value,
			index: index + 1
		};
		if (source[index] !== ",") return null;
		index = skipInsignificant(source, index + 1);
		if (source[index] === "}") return {
			value,
			index: index + 1
		};
	}
	return null;
}
function parseArrayLiteral(source, start) {
	const value = [];
	let index = skipInsignificant(source, start + 1);
	if (source[index] === "]") return {
		value,
		index: index + 1
	};
	while (index < source.length) {
		const parsedValue = parseLiteralValue(source, index);
		if (!parsedValue) return null;
		value.push(parsedValue.value);
		index = skipInsignificant(source, parsedValue.index);
		if (source[index] === "]") return {
			value,
			index: index + 1
		};
		if (source[index] !== ",") return null;
		index = skipInsignificant(source, index + 1);
		if (source[index] === "]") return {
			value,
			index: index + 1
		};
	}
	return null;
}
function parseStringLiteral(source, start) {
	const quote = source[start];
	const end = findStringEnd(source, start);
	if (end === -1) return null;
	const body = source.slice(start + 1, end);
	if (quote === "`" && body.includes("${")) return null;
	let value = "";
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (char !== "\\") {
			value += char;
			continue;
		}
		index += 1;
		if (index >= body.length) return null;
		const escaped = body[index];
		switch (escaped) {
			case "b":
				value += "\b";
				break;
			case "f":
				value += "\f";
				break;
			case "n":
				value += "\n";
				break;
			case "r":
				value += "\r";
				break;
			case "t":
				value += "	";
				break;
			case "v":
				value += "\v";
				break;
			case "0":
				value += "\0";
				break;
			case "x": {
				const hex = body.slice(index + 1, index + 3);
				if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
				value += String.fromCharCode(Number.parseInt(hex, 16));
				index += 2;
				break;
			}
			case "u": {
				if (body[index + 1] === "{") {
					const close = body.indexOf("}", index + 2);
					if (close === -1) return null;
					const hex = body.slice(index + 2, close);
					if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
					const codePoint = Number.parseInt(hex, 16);
					if (codePoint > 1114111) return null;
					value += String.fromCodePoint(codePoint);
					index = close;
					break;
				}
				const hex = body.slice(index + 1, index + 5);
				if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
				value += String.fromCharCode(Number.parseInt(hex, 16));
				index += 4;
				break;
			}
			default:
				value += escaped;
				break;
		}
	}
	return {
		value,
		index: end + 1
	};
}
function parseKeyword(source, start, keyword, value) {
	const end = start + keyword.length;
	return /[A-Za-z0-9_$]/.test(source[end] ?? "") ? null : {
		value,
		index: end
	};
}
function parseNumberLiteral(source, start) {
	const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(start));
	if (!match) return null;
	const end = start + match[0].length;
	if (/[A-Za-z0-9_$]/.test(source[end] ?? "")) return null;
	return {
		value: Number(match[0]),
		index: end
	};
}
//#endregion
export { evaluateLiteral, extractCapabilityProjection, extractCapabilityRegistrations, extractDefineAppObjectBody, extractDefineCapabilityArgs, findTopLevelObjectProperty, maskCommentsAndStrings, scanTopLevelProperties, scanTopLevelPropertyEntries };
