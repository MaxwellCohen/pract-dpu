//#region src/api-validation.ts
function isApiValidationErrorBody(value) {
	return typeof value === "object" && value !== null && value.error === "validation" && Array.isArray(value.issues) && value.issues.every(isApiValidationIssue);
}
function isApiValidationIssue(value) {
	if (typeof value !== "object" || value === null) return false;
	const issue = value;
	return (issue.in === "body" || issue.in === "query" || issue.in === "params") && typeof issue.message === "string" && (issue.path === void 0 || Array.isArray(issue.path) && issue.path.every((segment) => typeof segment === "string" || typeof segment === "number" && Number.isFinite(segment)));
}
/** Build the standardized validation failure response. */
function apiValidationErrorResponse(issues, init) {
	const body = {
		error: "validation",
		issues: issues.map((issue) => ({
			...issue,
			path: issue.path?.map(normalizeValidationPathSegment)
		}))
	};
	return Response.json(body, { status: init?.status ?? 422 });
}
/**
* `Response.json()` with the payload type preserved for `apiFetch()` callers.
* Use it when a handler needs a non-200 status or custom headers without
* collapsing the client-side response type to `unknown`:
*
* ```ts
* export const POST = defineApi({
*   body: itemSchema,
*   handler: ({ body }) => json({ created: body.name }, { status: 201 }),
* });
* ```
*/
function json(value, init) {
	assertApiJsonValue(value);
	return Response.json(value, init);
}
/**
* Define a validated API route handler.
*
* ```ts
* // src/api/items.ts
* import { defineApi } from "@pracht/core";
* import * as z from "zod";
*
* export const POST = defineApi({
*   body: z.object({ name: z.string() }),
*   handler: ({ body }) => ({ created: body.name }),
* });
* ```
*
* The wrapper validates `body`, `query`, and `params` with any
* [Standard Schema](https://standardschema.dev) validator before the handler
* runs, and answers invalid requests with a 422 JSON body
* (`{ error: "validation", issues }`). Handlers may return a `Response` for
* full control, or a JSON-safe value whose type survives `Response.json()`.
*/
function defineApi(config) {
	const handler = async (args) => {
		const issues = [];
		let query;
		if (config.query) query = await runSchema(config.query, searchParamsToRecord(args.url.searchParams), "query", issues);
		let params = args.params;
		if (config.params) params = await runSchema(config.params, args.params, "params", issues);
		let body;
		if (config.body) {
			const parsed = await readRequestBody(args.request);
			if (!parsed.ok) return apiValidationErrorResponse([parsed.issue], { status: 400 });
			body = await runSchema(config.body, parsed.value, "body", issues);
		}
		if (issues.length > 0) return apiValidationErrorResponse(issues);
		const result = await config.handler({
			...args,
			body,
			query,
			params
		});
		if (result instanceof Response) return result;
		assertApiJsonValue(result);
		return Response.json(result);
	};
	return Object.assign(handler, { schemas: {
		body: config.body,
		query: config.query,
		params: config.params
	} });
}
function assertApiJsonValue(value, path = "$", ancestors = /* @__PURE__ */ new Set()) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (Number.isFinite(value)) return;
		throw new TypeError(`defineApi() handler returned a non-finite number at ${path}.`);
	}
	if (typeof value !== "object") throw new TypeError(`defineApi() handler returned a non-JSON value at ${path}.`);
	if (ancestors.has(value)) throw new TypeError(`defineApi() handler returned a circular value at ${path}.`);
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeError(`defineApi() handler returned a non-plain object at ${path}.`);
	if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`defineApi() handler returned symbol-keyed data at ${path}.`);
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			for (const key of Object.keys(value)) if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) throw new TypeError(`defineApi() handler returned extra array data at ${path}.${key}.`);
			for (let index = 0; index < value.length; index += 1) {
				if (!(index in value)) throw new TypeError(`defineApi() handler returned a sparse array at ${path}[${index}].`);
				assertApiJsonValue(value[index], `${path}[${index}]`, ancestors);
			}
			return;
		}
		for (const [key, entry] of Object.entries(value)) assertApiJsonValue(entry, `${path}.${key}`, ancestors);
	} finally {
		ancestors.delete(value);
	}
}
/**
* Run a Standard Schema against a value and normalize the outcome: either the
* validated value, or issues tagged with the request part they belong to.
*/
async function validateStandardSchema(schema, value, source) {
	let result = schema["~standard"].validate(value);
	if (result instanceof Promise) result = await result;
	if (result.issues) return { issues: result.issues.map((issue) => ({
		in: source,
		message: issue.message,
		path: issue.path?.map((segment) => normalizeValidationPathSegment(typeof segment === "object" && segment !== null ? segment.key : segment))
	})) };
	return {
		issues: null,
		value: result.value
	};
}
function normalizeValidationPathSegment(segment) {
	return typeof segment === "symbol" || typeof segment === "number" && !Number.isFinite(segment) ? String(segment) : segment;
}
async function runSchema(schema, value, source, issues) {
	const result = await validateStandardSchema(schema, value, source);
	if (result.issues) {
		issues.push(...result.issues);
		return;
	}
	return result.value;
}
/**
* Query values presented to the `query` schema: one string per key, or an
* array of strings when the key repeats (`?tag=a&tag=b`).
*/
function searchParamsToRecord(searchParams) {
	return groupEntriesByKey(searchParams);
}
/**
* Form values presented to a schema: one entry per field, or an array when
* the field repeats (multi-selects, checkbox groups). File fields stay `File`.
*/
function formDataToRecord(formData) {
	return groupEntriesByKey(formData);
}
/**
* Group `[key, value]` pairs into one record: the value itself for a key that
* appears once, an array for a key that repeats.
*
* Deliberately a single pass. Iterating unique keys and calling `getAll(key)`
* per key reads as the obvious implementation, but `getAll` rescans the whole
* entry list, making the cost O(n²) in the number of distinct keys — bodies and
* query strings with many fields get slow fast. The record stays null-prototype
* so a `__proto__` field remains an ordinary own property.
*/
function groupEntriesByKey(entries) {
	const record = Object.create(null);
	const repeated = /* @__PURE__ */ new Set();
	for (const [key, value] of entries) if (!(key in record)) record[key] = value;
	else if (repeated.has(key)) record[key].push(value);
	else {
		repeated.add(key);
		record[key] = [record[key], value];
	}
	return record;
}
async function readRequestBody(request) {
	if (request.method === "GET" || request.method === "HEAD") return {
		ok: true,
		value: void 0
	};
	const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
	if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) try {
		return {
			ok: true,
			value: formDataToRecord(await request.formData())
		};
	} catch {
		return {
			ok: false,
			issue: {
				in: "body",
				message: "Malformed form body"
			}
		};
	}
	const text = await request.text();
	if (text === "") return {
		ok: true,
		value: void 0
	};
	if (contentType === "" || contentType.includes("json")) try {
		return {
			ok: true,
			value: JSON.parse(text)
		};
	} catch {
		return {
			ok: false,
			issue: {
				in: "body",
				message: "Malformed JSON body"
			}
		};
	}
	return {
		ok: true,
		value: text
	};
}
//#endregion
export { apiValidationErrorResponse, defineApi, formDataToRecord, isApiValidationErrorBody, json, searchParamsToRecord, validateStandardSchema };
