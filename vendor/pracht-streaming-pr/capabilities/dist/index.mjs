import { C as isValidMcpToolName, S as isValidCapabilityHttpPath, T as normalizeCapabilityHttpPath, _ as MCP_PROTOCOL_VERSION_HEADER, a as CAPABILITY_HTTP_PREFIX, b as capabilityHttpPath, c as CONFIRMATION_HEADER, d as MCP_CAPABILITY_META_KEY, f as MCP_CONFIRMATION_META_KEY, g as MCP_PROTOCOL_VERSIONS, h as MCP_LATEST_PROTOCOL_VERSION, i as CAPABILITY_FORM_REQUEST_HEADER, l as CONFIRMATION_SECRET_ENV, m as MCP_ERROR_META_KEY, n as CAPABILITY_ERROR_CODES, o as CAPABILITY_SETTLED_EVENT, p as MCP_EFFECT_META_KEY, r as CAPABILITY_FORM_REDIRECT_HEADER, s as CAPABILITY_TRANSPORT_HEADER, t as CAPABILITY_EFFECT_HEADER, u as DEFAULT_MCP_ENDPOINT, v as MCP_STATUS_META_KEY, w as mcpToolName, x as findMcpToolNameCollisions, y as MCP_TOOL_NAME_ERROR } from "./protocol-Cx7CpoHZ.mjs";
//#region src/schema.ts
const SUPPORTED_KEYWORDS = new Set([
	"type",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const",
	"minimum",
	"maximum",
	"minLength",
	"maxLength",
	"default",
	"title",
	"description"
]);
const SUPPORTED_TYPES = new Set([
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
]);
/**
* Walk a schema and collect every keyword outside the supported subset,
* prefixed with its schema path (e.g. `/properties/query/pattern`). Used by
* `defineCapability()` to fail fast and by `pracht verify` messaging.
*/
function collectUnsupportedSchemaKeywords(schema, path = "") {
	if (!isPlainObject$2(schema)) return [];
	const unsupported = [];
	for (const key of Object.keys(schema)) if (!SUPPORTED_KEYWORDS.has(key)) unsupported.push(`${path}/${key}`);
	if (typeof schema.type === "string" && !SUPPORTED_TYPES.has(schema.type)) unsupported.push(`${path}/type:${String(schema.type)}`);
	if (Array.isArray(schema.type)) unsupported.push(`${path}/type:<array of types>`);
	if (isPlainObject$2(schema.properties)) for (const [name, propertySchema] of Object.entries(schema.properties)) unsupported.push(...collectUnsupportedSchemaKeywords(propertySchema, `${path}/properties/${name}`));
	if (isPlainObject$2(schema.items)) unsupported.push(...collectUnsupportedSchemaKeywords(schema.items, `${path}/items`));
	if (Array.isArray(schema.items)) unsupported.push(`${path}/items:<tuple form>`);
	if (isPlainObject$2(schema.additionalProperties)) unsupported.push(...collectUnsupportedSchemaKeywords(schema.additionalProperties, `${path}/additionalProperties`));
	return unsupported;
}
/** Collect malformed values for keywords in the supported schema subset. */
function collectInvalidSchemaKeywordValues(schema, path = "") {
	if (!isPlainObject$2(schema)) return [`${path || "/"}:<expected schema object>`];
	const invalid = [];
	if ("type" in schema && (typeof schema.type !== "string" || !SUPPORTED_TYPES.has(schema.type))) invalid.push(`${path}/type:<expected supported type string>`);
	if ("properties" in schema && !isPlainObject$2(schema.properties)) invalid.push(`${path}/properties:<expected object>`);
	if ("required" in schema && (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== "string"))) invalid.push(`${path}/required:<expected string array>`);
	if ("additionalProperties" in schema && typeof schema.additionalProperties !== "boolean" && !isPlainObject$2(schema.additionalProperties)) invalid.push(`${path}/additionalProperties:<expected boolean or schema object>`);
	if ("items" in schema && !isPlainObject$2(schema.items)) invalid.push(`${path}/items:<expected schema object>`);
	if ("enum" in schema && (!Array.isArray(schema.enum) || schema.enum.length === 0)) invalid.push(`${path}/enum:<expected non-empty array>`);
	else if (Array.isArray(schema.enum)) {
		for (const [index, value] of schema.enum.entries()) if (!isJsonValue(value)) invalid.push(`${path}/enum/${index}:<expected JSON value>`);
	}
	for (const keyword of ["const", "default"]) if (keyword in schema && !isJsonValue(schema[keyword])) invalid.push(`${path}/${keyword}:<expected JSON value>`);
	for (const keyword of ["minimum", "maximum"]) if (keyword in schema && (typeof schema[keyword] !== "number" || !Number.isFinite(schema[keyword]))) invalid.push(`${path}/${keyword}:<expected finite number>`);
	for (const keyword of ["minLength", "maxLength"]) if (keyword in schema && (typeof schema[keyword] !== "number" || !Number.isInteger(schema[keyword]) || schema[keyword] < 0)) invalid.push(`${path}/${keyword}:<expected non-negative integer>`);
	for (const keyword of ["title", "description"]) if (keyword in schema && typeof schema[keyword] !== "string") invalid.push(`${path}/${keyword}:<expected string>`);
	if (isPlainObject$2(schema.properties)) for (const [name, propertySchema] of Object.entries(schema.properties)) invalid.push(...collectInvalidSchemaKeywordValues(propertySchema, `${path}/properties/${name}`));
	if (isPlainObject$2(schema.items)) invalid.push(...collectInvalidSchemaKeywordValues(schema.items, `${path}/items`));
	if (isPlainObject$2(schema.additionalProperties)) invalid.push(...collectInvalidSchemaKeywordValues(schema.additionalProperties, `${path}/additionalProperties`));
	return invalid;
}
/**
* Return a copy of `value` with schema `default`s filled in for missing
* object properties, recursively. The input value is never mutated.
*/
function applySchemaDefaults(schema, value) {
	if (!isPlainObject$2(schema)) return value;
	if (isPlainObject$2(value) && isPlainObject$2(schema.properties)) {
		const result = { ...value };
		for (const [name, propertySchema] of Object.entries(schema.properties)) {
			if (!Object.hasOwn(result, name)) {
				if (isPlainObject$2(propertySchema) && "default" in propertySchema) result[name] = cloneJson(propertySchema.default);
				continue;
			}
			result[name] = applySchemaDefaults(propertySchema, result[name]);
		}
		return result;
	}
	if (Array.isArray(value) && isPlainObject$2(schema.items)) return value.map((item) => applySchemaDefaults(schema.items, item));
	return value;
}
/**
* Validate `value` against the schema subset. Returns an empty array when the
* value conforms. Every issue carries a path scoped to the offending value so
* callers (and agents) can pinpoint what to fix.
*/
function validateAgainstSchema(schema, value, path = "") {
	const nonJsonIssue = findNonJsonIssue(value, path);
	if (nonJsonIssue) return [nonJsonIssue];
	return validateJsonAgainstSchema(schema, value, path);
}
function validateJsonAgainstSchema(schema, value, path) {
	if (!isPlainObject$2(schema)) return [];
	const issues = [];
	if ("const" in schema && !jsonEquals(value, schema.const)) {
		issues.push({
			path,
			message: `must equal ${JSON.stringify(schema.const)}`
		});
		return issues;
	}
	if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonEquals(value, candidate))) {
		issues.push({
			path,
			message: `must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(", ")}`
		});
		return issues;
	}
	const type = typeof schema.type === "string" ? schema.type : void 0;
	if (type && !matchesType(type, value)) {
		issues.push({
			path,
			message: `must be of type ${type}, got ${describeValue(value)}`
		});
		return issues;
	}
	if (typeof value === "string") {
		const length = Array.from(value).length;
		if (typeof schema.minLength === "number" && length < schema.minLength) issues.push({
			path,
			message: `must be at least ${schema.minLength} character(s) long`
		});
		if (typeof schema.maxLength === "number" && length > schema.maxLength) issues.push({
			path,
			message: `must be at most ${schema.maxLength} character(s) long`
		});
	}
	if (typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) issues.push({
			path,
			message: `must be >= ${schema.minimum}`
		});
		if (typeof schema.maximum === "number" && value > schema.maximum) issues.push({
			path,
			message: `must be <= ${schema.maximum}`
		});
	}
	if (isPlainObject$2(value)) {
		const properties = isPlainObject$2(schema.properties) ? schema.properties : {};
		if (Array.isArray(schema.required)) {
			for (const name of schema.required) if (typeof name === "string" && !Object.hasOwn(value, name)) issues.push({
				path: `${path}/${name}`,
				message: "is required"
			});
		}
		for (const [name, propertyValue] of Object.entries(value)) {
			if (Object.hasOwn(properties, name)) {
				const propertySchema = properties[name];
				issues.push(...validateJsonAgainstSchema(propertySchema, propertyValue, `${path}/${name}`));
				continue;
			}
			if (schema.additionalProperties === false) issues.push({
				path: `${path}/${name}`,
				message: "is not an allowed property"
			});
			else if (isPlainObject$2(schema.additionalProperties)) issues.push(...validateJsonAgainstSchema(schema.additionalProperties, propertyValue, `${path}/${name}`));
		}
	}
	if (Array.isArray(value) && isPlainObject$2(schema.items)) for (let index = 0; index < value.length; index += 1) issues.push(...validateJsonAgainstSchema(schema.items, value[index], `${path}/${index}`));
	return issues;
}
/**
* JSON Schema describes JSON data, so reject JavaScript-only values even when
* the schema is unconstrained or permits additional properties. This matters
* for direct invocation and multipart forms, which can otherwise introduce
* values such as `File`/`Blob` that JSON requests can never represent.
*/
function findNonJsonIssue(value, path, ancestors = /* @__PURE__ */ new Set()) {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return null;
	if (typeof value !== "object") return {
		path,
		message: `must be JSON-serializable, got ${typeof value}`
	};
	if (!Array.isArray(value) && !isPlainObject$2(value)) return {
		path,
		message: "must be JSON-serializable, got object"
	};
	if (ancestors.has(value)) return {
		path,
		message: "must be JSON-serializable, got a circular reference"
	};
	ancestors.add(value);
	if (Array.isArray(value)) for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) {
			ancestors.delete(value);
			return {
				path: `${path}/${index}`,
				message: "must be JSON-serializable, got a sparse array slot"
			};
		}
		const issue = findNonJsonIssue(value[index], `${path}/${index}`, ancestors);
		if (issue) {
			ancestors.delete(value);
			return issue;
		}
	}
	else for (const [key, entry] of Object.entries(value)) {
		const issue = findNonJsonIssue(entry, `${path}/${key}`, ancestors);
		if (issue) {
			ancestors.delete(value);
			return issue;
		}
	}
	ancestors.delete(value);
	return null;
}
function isJsonValue(value) {
	return findNonJsonIssue(value, "") === null;
}
function matchesType(type, value) {
	switch (type) {
		case "object": return isPlainObject$2(value);
		case "array": return Array.isArray(value);
		case "string": return typeof value === "string";
		case "number": return typeof value === "number" && Number.isFinite(value);
		case "integer": return typeof value === "number" && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		default: return false;
	}
}
function describeValue(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
function jsonEquals(left, right) {
	if (Object.is(left, right)) return true;
	if (typeof left !== typeof right) return false;
	if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => jsonEquals(item, right[index]));
	if (isPlainObject$2(left) && isPlainObject$2(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquals(left[key], right[key]));
	}
	return false;
}
function cloneJson(value) {
	if (value === null || typeof value !== "object") return value;
	return JSON.parse(JSON.stringify(value));
}
function isPlainObject$2(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
//#endregion
//#region src/capability.ts
const DESTRUCTIVE_EXPOSURE_ERROR = "destructive capabilities cannot be exposed to agent projections (webmcp/mcp) yet — only expose.http, where the prepare/commit confirmation flow gates every call";
const MCP_SCHEMA_ROOT_ERROR = "expose.mcp requires \"input\" and \"output\" schemas with type: \"object\" for the supported MCP protocol versions";
/**
* Define a protocol-neutral application capability.
*
* Fails fast (throws) on invalid definitions instead of deferring problems to
* request time: missing contract fields, schemas outside the supported JSON
* Schema subset, `webmcp` exposure without an HTTP projection to dispatch
* through, and `webmcp`/`mcp` exposure of a `destructive` capability
* (destructive + `expose.http` is allowed — the runtime's server-verified
* prepare/commit confirmation flow gates every dispatch).
*/
function defineCapability(definition) {
	assertDefinition(definition);
	const expose = normalizeExposure(definition.expose);
	if (definition.effect === "destructive" && (expose?.webmcp || expose?.mcp)) throw new Error(`defineCapability("${definition.title}"): ${DESTRUCTIVE_EXPOSURE_ERROR}.`);
	if (expose?.webmcp && !expose.http) throw new Error(`defineCapability("${definition.title}"): expose.webmcp requires expose.http — WebMCP page tools dispatch through the HTTP projection so all enforcement stays server-side.`);
	if (expose?.mcp && (definition.input.type !== "object" || definition.output.type !== "object")) throw new Error(`defineCapability("${definition.title}"): ${MCP_SCHEMA_ROOT_ERROR}.`);
	return {
		kind: "capability",
		title: definition.title,
		description: definition.description,
		input: definition.input,
		output: definition.output,
		effect: definition.effect,
		middleware: definition.middleware ?? [],
		expose,
		agentPolicy: definition.agentPolicy,
		run: definition.run,
		validateInput(value) {
			const withDefaults = applySchemaDefaults(definition.input, value === void 0 ? {} : value);
			const issues = validateAgainstSchema(definition.input, withDefaults);
			if (issues.length > 0) return {
				ok: false,
				issues
			};
			return {
				ok: true,
				value: withDefaults
			};
		},
		validateOutput(value) {
			const issues = validateAgainstSchema(definition.output, value);
			if (issues.length > 0) return {
				ok: false,
				issues
			};
			return {
				ok: true,
				value
			};
		}
	};
}
function assertDefinition(definition) {
	const label = typeof definition?.title === "string" ? definition.title : "<untitled>";
	if (!definition || typeof definition !== "object") throw new Error("defineCapability expects a definition object.");
	for (const field of ["title", "description"]) if (typeof definition[field] !== "string" || definition[field].trim() === "") throw new Error(`defineCapability("${label}"): "${field}" must be a non-empty string.`);
	if (definition.effect !== "read" && definition.effect !== "write" && definition.effect !== "destructive") throw new Error(`defineCapability("${label}"): "effect" must be "read", "write", or "destructive".`);
	if (typeof definition.run !== "function") throw new Error(`defineCapability("${label}"): "run" must be a function.`);
	for (const field of ["input", "output"]) {
		const schema = definition[field];
		if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`defineCapability("${label}"): "${field}" must be a JSON Schema object.`);
		const unsupported = collectUnsupportedSchemaKeywords(schema);
		const invalid = collectInvalidSchemaKeywordValues(schema);
		if (unsupported.length > 0) throw new Error(`defineCapability("${label}"): "${field}" schema uses unsupported JSON Schema keywords: ${unsupported.join(", ")}. Supported keywords: type (object/array/string/number/integer/boolean/null), properties, required, additionalProperties, items, enum, const, minimum, maximum, minLength, maxLength, default, title, description.`);
		if (invalid.length > 0) throw new Error(`defineCapability("${label}"): "${field}" schema has invalid JSON Schema values: ${invalid.join(", ")}.`);
	}
	if (definition.middleware !== void 0 && (!Array.isArray(definition.middleware) || definition.middleware.some((name) => typeof name !== "string"))) throw new Error(`defineCapability("${label}"): "middleware" must be an array of names.`);
	if (definition.agentPolicy !== void 0 && definition.agentPolicy !== "observe" && definition.agentPolicy !== "require") throw new Error(`defineCapability("${label}"): "agentPolicy" must be "observe" or "require".`);
}
function normalizeExposure(expose) {
	if (!expose) return null;
	let http = null;
	if (expose.http === true) http = { method: "POST" };
	else if (expose.http && typeof expose.http === "object") {
		if (expose.http.method !== void 0 && expose.http.method !== "POST") throw new Error("Capability HTTP exposure only supports method: \"POST\" for now.");
		if (expose.http.path !== void 0) {
			if (!isValidCapabilityHttpPath(expose.http.path)) throw new Error("Capability HTTP exposure \"path\" must be an exact same-origin pathname starting with \"/\".");
			http = {
				method: "POST",
				path: expose.http.path
			};
		} else http = { method: "POST" };
	}
	const normalized = {
		http,
		mcp: expose.mcp === true,
		webmcp: expose.webmcp === true
	};
	if (!normalized.http && !normalized.mcp && !normalized.webmcp) return null;
	return normalized;
}
//#endregion
//#region src/form.ts
/**
* Coerce HTML form fields into the shapes a capability input schema expects.
*
* Progressive-enhancement `<Form capability>` submissions arrive as
* `application/x-www-form-urlencoded` strings; the framework maps them onto
* the input schema before validation: numbers are parsed, checkbox values
* become booleans, and repeated fields become arrays when the schema says
* array. Values that do not parse pass through unchanged so schema validation
* produces its usual, precise issue paths instead of a coercion error.
*/
function coerceFormInput(schema, entries) {
	const properties = isPlainObject$1(schema) && isPlainObject$1(schema.properties) ? schema.properties : {};
	const grouped = /* @__PURE__ */ new Map();
	for (const [name, raw] of entries) {
		const bucket = grouped.get(name) ?? [];
		bucket.push(raw);
		grouped.set(name, bucket);
	}
	const result = {};
	for (const [name, values] of grouped) {
		const declared = Object.hasOwn(properties, name) ? properties[name] : void 0;
		const propertySchema = isPlainObject$1(declared) ? declared : null;
		let coerced;
		if (propertySchema?.type === "array") {
			const itemType = isPlainObject$1(propertySchema.items) ? propertySchema.items.type : void 0;
			coerced = values.map((value) => coerceScalar(itemType, value));
		} else coerced = coerceScalar(propertySchema?.type, values[values.length - 1]);
		Object.defineProperty(result, name, {
			configurable: true,
			enumerable: true,
			value: coerced,
			writable: true
		});
	}
	return result;
}
function coerceScalar(type, value) {
	if (typeof value !== "string") return value;
	switch (type) {
		case "number":
		case "integer": {
			if (value.trim() === "") return value;
			const parsed = Number(value);
			return Number.isNaN(parsed) ? value : parsed;
		}
		case "boolean":
			if (value === "true" || value === "on") return true;
			if (value === "false") return false;
			return value;
		case "null": return value === "" || value === "null" ? null : value;
		default: return value;
	}
}
function isPlainObject$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/schema-type-text.ts
function schemaToTypeText(schema, position) {
	if (!isPlainObject(schema)) return "unknown";
	if ("const" in schema) return jsonToLiteralType(schema.const);
	if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum.map(jsonToLiteralType).join(" | ");
	switch (schema.type) {
		case "string": return "string";
		case "number":
		case "integer": return "number";
		case "boolean": return "boolean";
		case "null": return "null";
		case "array": return `Array<${schemaToTypeText(schema.items, position)}>`;
		case "object": return objectTypeText(schema, position);
		default: return "unknown";
	}
}
function objectTypeText(schema, position) {
	const properties = isPlainObject(schema.properties) ? schema.properties : null;
	const additional = schema.additionalProperties;
	if (!properties || Object.keys(properties).length === 0) {
		if (additional === false) return "Record<string, never>";
		if (isPlainObject(additional)) return `Record<string, ${schemaToTypeText(additional, position)}>`;
		return "Record<string, unknown>";
	}
	const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name) => typeof name === "string") : []);
	const members = Object.entries(properties).map(([name, propertySchema]) => {
		const hasDefault = isPlainObject(propertySchema) && "default" in propertySchema;
		const optional = position === "input" ? !required.has(name) || hasDefault : !required.has(name);
		return `${JSON.stringify(name)}${optional ? "?" : ""}: ${schemaToTypeText(propertySchema, position)};`;
	});
	if (additional !== false) members.push("[key: string]: unknown;");
	return `{ ${members.join(" ")} }`;
}
/** Render a JSON value as a TypeScript literal type (for `const`/`enum`). */
function jsonToLiteralType(value) {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(jsonToLiteralType).join(", ")}]`;
	if (isPlainObject(value)) return `{ ${Object.entries(value).map(([name, member]) => `${JSON.stringify(name)}: ${jsonToLiteralType(member)};`).join(" ")} }`;
	return "unknown";
}
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
export { CAPABILITY_EFFECT_HEADER, CAPABILITY_ERROR_CODES, CAPABILITY_FORM_REDIRECT_HEADER, CAPABILITY_FORM_REQUEST_HEADER, CAPABILITY_HTTP_PREFIX, CAPABILITY_SETTLED_EVENT, CAPABILITY_TRANSPORT_HEADER, CONFIRMATION_HEADER, CONFIRMATION_SECRET_ENV, DEFAULT_MCP_ENDPOINT, DESTRUCTIVE_EXPOSURE_ERROR, MCP_CAPABILITY_META_KEY, MCP_CONFIRMATION_META_KEY, MCP_EFFECT_META_KEY, MCP_ERROR_META_KEY, MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSION_HEADER, MCP_SCHEMA_ROOT_ERROR, MCP_STATUS_META_KEY, MCP_TOOL_NAME_ERROR, applySchemaDefaults, capabilityHttpPath, coerceFormInput, collectInvalidSchemaKeywordValues, collectUnsupportedSchemaKeywords, defineCapability, findMcpToolNameCollisions, isValidCapabilityHttpPath, isValidMcpToolName, mcpToolName, normalizeCapabilityHttpPath, schemaToTypeText, validateAgainstSchema };
