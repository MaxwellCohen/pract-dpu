import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIRMATION_HEADER, DEFAULT_MCP_ENDPOINT, MCP_CONFIRMATION_META_KEY, MCP_ERROR_META_KEY, MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSION_HEADER, MCP_STATUS_META_KEY, capabilityHttpPath, mcpToolName } from "@pracht/capabilities";
import { createAgentSignatureHeaders } from "@pracht/core/agent-auth";
//#region src/eval-runner.ts
/**
* `pracht eval` — scripted agent-task harness.
*
* Runs JSON scenario files against a live app's agent surface and checks each
* step's outcome, turning the capability graph's proof metrics ("can an agent
* actually complete this task through my tools?") into repeatable CI checks.
* Two transports, one scenario format: the capability HTTP projection
* (`/api/capabilities/*`, the default) and the remote MCP projection (JSON-RPC
* `tools/call` against `/mcp`), so an app that advertises `expose.mcp` can
* prove an MCP host actually reaches the tool. Scenario format
* (docs/AGENT_TRUST.md):
*
*   {
*     "name": "notes flow",
*     "task": "search, then purge with confirmation",
*     "url": "http://localhost:3000",        // optional; --url overrides
*     "transport": "http",                   // or "mcp"; default "http"
*     "mcpPath": "/mcp",                     // MCP endpoint, when it is not the default
*     "mcpHeaders": { "authorization": "Bearer ..." }, // every MCP request
*     "steps": [
*       {
*         "capability": "notes.search",       // or "path": "/api/custom"
*         "input": { "query": "roadmap" },
*         "confirm": "$steps[0].error.confirmationToken",  // HTTP: confirmation header
*         "expect": { "ok": true, "errorCode": "...", "status": 200,
*                     "output": { "notes": [] } }  // subset match
*       }
*     ],
*     "signAs": {                              // optional Web Bot Auth identity
*       "agent": "https://my-agent.example",
*       "privateKeyJwk": { "kty": "OKP", "crv": "Ed25519", "d": "...", "x": "..." }
*     }
*   }
*
* `signAs` signs every step with RFC 9421 HTTP Message Signatures, which is
* what a capability declaring `agentPolicy: "require"` demands. Per-step
* `"sign": false` opts a step out, so one scenario can prove both the signed
* and unsigned halves of an agent-trust policy. Over MCP the same identity
* signs the JSON-RPC POSTs, so an agent-identity policy is exercisable on
* either transport.
*
* Destructive prepare/commit works over MCP when the app opts in, exposes the
* capability, and registers an approval store. `confirm` is carried in the
* `tools/call` `_meta["io.pracht/confirmation"]` field — the slot the
* projection reads. Step `headers` are still limited to `authorization` over
* MCP, the only header the projection forwards.
*
* Reference syntax: a string value that is exactly `$steps[<index>].<path>`
* is replaced with that value from an earlier step's result. The root object
* per step is `{ status, ok, data, error }` — e.g.
* `$steps[0].error.confirmationToken` or `$steps[1].data.note.id`. MCP steps
* fill the same shape: `data` is the tool result's `structuredContent`,
* `error` is its `io.pracht/error` metadata, and `status` is the capability
* dispatch status the projection reports in `io.pracht/status` — *not* the
* JSON-RPC POST status, which is 200 for every answered `tools/call` and would
* make `"status": 200` pass on a failed call. Expectations are therefore
* written once and mean the same thing on both transports; the raw transport
* status stays available as `$steps[n].transportStatus`.
*/
/**
* Resolve scenario files: explicit paths as-is, otherwise every
* `*.eval.json` under `evals/` (recursively).
*/
function findEvalFiles(cwd, explicit) {
	if (explicit.length > 0) return explicit.map((file) => resolve(cwd, file));
	const files = [];
	walkForEvalFiles(resolve(cwd, "evals"), files);
	return files.sort();
}
function walkForEvalFiles(dir, files) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		let stats;
		try {
			stats = statSync(full);
		} catch {
			continue;
		}
		if (stats.isDirectory()) walkForEvalFiles(full, files);
		else if (entry.endsWith(".eval.json")) files.push(full);
	}
}
function parseScenario(file) {
	const parsed = JSON.parse(readFileSync(file, "utf-8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("scenario must be a JSON object");
	const scenario = parsed;
	if (typeof scenario.name !== "string" || scenario.name === "") throw new Error("scenario is missing a \"name\"");
	if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) throw new Error("scenario needs a non-empty \"steps\" array");
	for (const [index, step] of scenario.steps.entries()) if (!step || typeof step !== "object" || typeof step.capability !== "string") throw new Error(`step ${index} is missing a "capability" name`);
	if (scenario.transport !== void 0 && scenario.transport !== "http" && scenario.transport !== "mcp") throw new Error(`"transport" must be "http" or "mcp", got ${JSON.stringify(scenario.transport)}`);
	if (scenario.mcpPath !== void 0) {
		if (typeof scenario.mcpPath !== "string" || !scenario.mcpPath.startsWith("/")) throw new Error("\"mcpPath\" must be an absolute path such as \"/mcp\"");
		if (scenario.transport !== "mcp") throw new Error("\"mcpPath\" only applies to a scenario with \"transport\": \"mcp\"");
	}
	if (scenario.mcpHeaders !== void 0) {
		if (scenario.transport !== "mcp") throw new Error("\"mcpHeaders\" only applies to a scenario with \"transport\": \"mcp\"");
		if (!scenario.mcpHeaders || typeof scenario.mcpHeaders !== "object" || Array.isArray(scenario.mcpHeaders)) throw new Error("\"mcpHeaders\" must be an object of string header values");
		const normalizedHeaders = {};
		for (const [name, value] of Object.entries(scenario.mcpHeaders)) {
			if (name.toLowerCase() !== MCP_FORWARDED_HEADER) throw new Error(`"mcpHeaders" sets ${JSON.stringify(name)}, but only ${JSON.stringify(MCP_FORWARDED_HEADER)} is supported`);
			if (typeof value !== "string") throw new Error(`"mcpHeaders.${name}" must be a string`);
			normalizedHeaders[MCP_FORWARDED_HEADER] = value;
		}
		scenario.mcpHeaders = normalizedHeaders;
	}
	if (scenario.transport === "mcp") {
		const withPath = scenario.steps.findIndex((step) => step.path !== void 0);
		if (withPath >= 0) throw new Error(`step ${withPath} sets "path", which only applies to the HTTP transport — an MCP step is addressed by its projected tool name`);
	}
	if (scenario.signAs !== void 0) {
		const signAs = scenario.signAs;
		if (!signAs || typeof signAs !== "object") throw new Error("\"signAs\" must be an object with \"agent\" and \"privateKeyJwk\"");
		if (typeof signAs.agent !== "string" || signAs.agent === "") throw new Error("\"signAs.agent\" must be the agent's identity URL");
		const jwk = signAs.privateKeyJwk;
		if (!jwk || jwk.kty !== "OKP" || jwk.crv !== "Ed25519") throw new Error("\"signAs.privateKeyJwk\" must be an Ed25519 OKP JWK");
		if (typeof jwk.d !== "string" || typeof jwk.x !== "string") throw new Error("\"signAs.privateKeyJwk\" needs both \"d\" (private) and \"x\" (public)");
	}
	return scenario;
}
const REFERENCE_RE = /^\$steps\[(\d+)\]\.(.+)$/;
/**
* Replace `$steps[n].<path>` string values (in inputs/headers) with values
* from earlier step results. Unknown indices or paths throw — a scenario
* referencing a value that does not exist is a scenario bug.
*/
function resolveStepReferences(value, prior) {
	if (typeof value === "string") {
		const match = REFERENCE_RE.exec(value);
		if (!match) return value;
		const index = Number(match[1]);
		if (index >= prior.length) throw new Error(`reference "${value}" points at step ${index}, which has not run yet`);
		let current = prior[index].resultForReferences;
		for (const segment of match[2].split(".")) {
			if (!current || typeof current !== "object") throw new Error(`reference "${value}" found nothing at "${segment}"`);
			current = current[segment];
		}
		if (current === void 0) throw new Error(`reference "${value}" resolved to undefined`);
		return current;
	}
	if (Array.isArray(value)) return value.map((item) => resolveStepReferences(item, prior));
	if (value && typeof value === "object") {
		const result = {};
		for (const [key, entry] of Object.entries(value)) result[key] = resolveStepReferences(entry, prior);
		return result;
	}
	return value;
}
/** Deep subset match: every property in `expected` must equal/subset-match `actual`. */
function matchesSubset(actual, expected) {
	if (expected === null || typeof expected !== "object") return actual === expected;
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length !== expected.length) return false;
		return expected.every((item, index) => matchesSubset(actual[index], item));
	}
	if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
	return Object.entries(expected).every(([key, value]) => matchesSubset(actual[key], value));
}
/**
* `status` is the *capability dispatch* status on either transport — see
* `dispatchFromToolResult()` for how the MCP side derives it. Passing the
* JSON-RPC POST status here instead would make `"status": 200` pass on a failed
* `tools/call`.
*/
function collectExpectationFailures(expect, status, envelope) {
	const failures = [];
	if (!expect) {
		if (envelope.ok !== true) failures.push(`expected ok envelope, got ${String(envelope.error?.code ?? "ok=" + String(envelope.ok))} (status ${status})`);
		return failures;
	}
	if (expect.ok !== void 0 && envelope.ok !== expect.ok) failures.push(`expected ok=${expect.ok}, got ok=${String(envelope.ok)}`);
	if (expect.status !== void 0 && status !== expect.status) failures.push(`expected status ${expect.status}, got ${status}`);
	if (expect.errorCode !== void 0 && envelope.error?.code !== expect.errorCode) failures.push(`expected error code "${expect.errorCode}", got ${JSON.stringify(envelope.error?.code ?? null)}`);
	if (expect.output !== void 0 && !matchesSubset(envelope.data, expect.output)) failures.push(`output does not match expected subset ${JSON.stringify(expect.output)}`);
	return failures;
}
async function runScenario(scenario, file, options) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const transport = scenario.transport ?? "http";
	const steps = [];
	const abort = (error) => ({
		name: scenario.name,
		file,
		transport,
		ok: false,
		steps,
		error
	});
	let session;
	if (transport === "mcp") {
		const opened = await openMcpSession(new URL(scenario.mcpPath ?? DEFAULT_MCP_ENDPOINT, options.baseUrl).toString(), scenario, fetchImpl);
		if ("error" in opened) return abort(opened.error);
		session = opened.session;
	}
	for (const [index, step] of scenario.steps.entries()) {
		let input;
		let headers;
		let confirmation;
		try {
			input = resolveStepReferences(step.input === void 0 ? {} : step.input, steps);
			headers = resolveStepReferences(step.headers ?? {}, steps);
			if (step.confirm !== void 0) confirmation = String(resolveStepReferences(step.confirm, steps));
		} catch (error) {
			return abort(error instanceof Error ? error.message : String(error));
		}
		const sign = scenario.signAs !== void 0 && step.sign !== false;
		const started = performance.now();
		const dispatched = session ? await callMcpTool({
			session,
			step,
			index,
			input,
			headers,
			confirmation,
			sign
		}) : await callHttpCapability({
			baseUrl: options.baseUrl,
			fetchImpl,
			signAs: sign ? scenario.signAs : void 0,
			step,
			input,
			headers: confirmation === void 0 ? headers : {
				...headers,
				[CONFIRMATION_HEADER]: confirmation
			}
		});
		if ("error" in dispatched) return abort(dispatched.error);
		const latencyMs = performance.now() - started;
		const { status, transportStatus, envelope } = dispatched;
		const failures = collectExpectationFailures(step.expect, status, envelope);
		steps.push({
			capability: step.capability,
			transport,
			status,
			transportStatus,
			ok: envelope.ok === true,
			latencyMs,
			errorCode: envelope.ok === true ? null : typeof envelope.error?.code === "string" ? envelope.error.code : null,
			failures,
			resultForReferences: {
				status,
				transportStatus,
				...envelope
			}
		});
	}
	return {
		name: scenario.name,
		file,
		transport,
		ok: steps.every((step) => step.failures.length === 0),
		steps,
		error: null
	};
}
async function callHttpCapability(args) {
	const { baseUrl, fetchImpl, signAs, step, input } = args;
	const headers = { ...args.headers };
	const path = step.path ?? capabilityHttpPath(step.capability);
	const url = new URL(path, baseUrl).toString();
	if (signAs) {
		const signature = await signRequestHeaders(url, signAs);
		if ("error" in signature) return { error: `could not sign step "${step.capability}": ${signature.error}` };
		Object.assign(headers, signature.headers);
	}
	try {
		const response = await fetchImpl(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...headers
			},
			body: JSON.stringify(input)
		});
		return {
			status: response.status,
			transportStatus: response.status,
			envelope: await response.json()
		};
	} catch (error) {
		return { error: `request to ${url} failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
async function signRequestHeaders(url, signAs) {
	try {
		return { headers: { ...await createAgentSignatureHeaders(new Request(url, { method: "POST" }), signAs) } };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}
/** Client identity sent in `initialize`; hosts log it, and so do app audit events. */
const MCP_CLIENT_INFO = {
	name: "pracht-eval",
	version: "1.0.0"
};
/**
* The only step header the MCP projection forwards to the capability. It
* synthesizes the inner request itself and copies nothing else, so any other
* header would be accepted by the runner and then silently never arrive.
*/
const MCP_FORWARDED_HEADER = "authorization";
/**
* Headers the MCP endpoint refuses outright (403), because remote MCP has no
* browser use case and must never be authenticated by an ambient cookie.
* Called out separately so the failure explains the 403 rather than the drop.
*/
const MCP_REFUSED_HEADERS = [
	"cookie",
	"origin",
	"sec-fetch-site"
];
async function openMcpSession(endpoint, scenario, fetchImpl) {
	const session = {
		endpoint,
		headers: { ...scenario.mcpHeaders },
		protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
		nextId: 1,
		signAs: scenario.signAs,
		fetchImpl
	};
	const response = await mcpRequest(session, {
		method: "initialize",
		params: {
			protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: MCP_CLIENT_INFO
		},
		sign: scenario.signAs !== void 0,
		signLabel: "the MCP initialize request",
		declareProtocolVersion: false
	});
	if ("error" in response) return { error: response.error };
	if (response.status !== 200) return { error: describeMcpEndpointStatus(endpoint, response) };
	const body = asRecord(response.body);
	if (!body) return { error: `MCP initialize at ${endpoint} did not answer with JSON: ${snippet(response.bodyText)}` };
	if (body.error !== void 0) return { error: `MCP initialize at ${endpoint} was rejected: ${describeJsonRpcError(body.error)}` };
	const negotiated = asRecord(body.result)?.protocolVersion;
	if (typeof negotiated !== "string") return { error: `MCP initialize at ${endpoint} answered without a protocolVersion: ${snippet(response.bodyText)}` };
	if (!MCP_PROTOCOL_VERSIONS.includes(negotiated)) return { error: `MCP initialize at ${endpoint} negotiated protocol version ${JSON.stringify(negotiated)}, which pracht eval does not speak. Supported: ${MCP_PROTOCOL_VERSIONS.join(", ")}.` };
	session.protocolVersion = negotiated;
	await mcpRequest(session, {
		method: "notifications/initialized",
		notification: true,
		sign: scenario.signAs !== void 0,
		signLabel: "the MCP initialized notification"
	});
	return { session };
}
async function callMcpTool(args) {
	const { session, step, index, input, headers, confirmation, sign } = args;
	const toolName = mcpToolName(step.capability);
	const unsupported = Object.keys(headers).find((name) => name.toLowerCase() !== MCP_FORWARDED_HEADER);
	if (unsupported) {
		const refused = MCP_REFUSED_HEADERS.includes(unsupported.toLowerCase());
		return { error: `step ${index + 1} "${step.capability}" sets the "${unsupported}" header, which cannot ` + (refused ? "reach the capability over MCP: the endpoint refuses the whole request with 403, because remote MCP is never browser-originated and never cookie-authenticated." : `reach the capability over MCP: the projection synthesizes the capability request and copies only "${MCP_FORWARDED_HEADER}", so the header would silently vanish.`) + " Drop it, or run this step with \"transport\": \"http\"." };
	}
	const response = await mcpRequest(session, {
		method: "tools/call",
		params: {
			name: toolName,
			arguments: input,
			...confirmation === void 0 ? {} : { _meta: { [MCP_CONFIRMATION_META_KEY]: confirmation } }
		},
		headers,
		sign,
		signLabel: `step "${step.capability}"`
	});
	if ("error" in response) return response;
	if (response.status !== 200) return { error: describeMcpEndpointStatus(session.endpoint, response) };
	const body = asRecord(response.body);
	if (!body) return { error: `tools/call for "${toolName}" did not answer with JSON-RPC: ${snippet(response.bodyText)}` };
	if (body.error !== void 0) return { error: describeToolCallRejection(step.capability, toolName, body.error) };
	const result = asRecord(body.result);
	if (!result) return { error: `tools/call for "${toolName}" answered without a result object: ${snippet(response.bodyText)}` };
	return dispatchFromToolResult(toolName, result, response.status);
}
async function mcpRequest(session, options) {
	const headers = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
		...session.headers,
		...options.headers
	};
	if (options.declareProtocolVersion !== false) headers[MCP_PROTOCOL_VERSION_HEADER] = session.protocolVersion;
	if (options.sign && session.signAs) {
		const signature = await signRequestHeaders(session.endpoint, session.signAs);
		if ("error" in signature) return { error: `could not sign ${options.signLabel}: ${signature.error}` };
		Object.assign(headers, signature.headers);
	}
	const payload = {
		jsonrpc: "2.0",
		...options.notification ? {} : { id: session.nextId++ },
		method: options.method,
		...options.params === void 0 ? {} : { params: options.params }
	};
	let status;
	let bodyText;
	try {
		const response = await session.fetchImpl(session.endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(payload)
		});
		status = response.status;
		bodyText = await response.text();
	} catch (error) {
		return { error: `request to ${session.endpoint} failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	let body;
	if (bodyText.trim() !== "") try {
		body = JSON.parse(bodyText);
	} catch {
		body = void 0;
	}
	return {
		status,
		body,
		bodyText
	};
}
/**
* Envelope + status view of an MCP tool result, so `expect` means the same
* thing on both transports: `isError` is the envelope's `ok`,
* `structuredContent` is its `data`, and the projection's `io.pracht/error`
* metadata is its `error`.
*
* `status` is the deliberate one. Every answered `tools/call` is HTTP 200, so
* reporting the transport status would make `"status": 200` pass on a call that
* failed — a silent false green, and the opposite of what the same expectation
* does over HTTP. The projection sends the capability's dispatch status in
* `io.pracht/status` precisely so a machine caller can recover it; a failed
* result without that metadata (a non-Pracht server) reports 500 rather than
* borrowing the transport's 200, because "the tool failed" must never satisfy a
* success expectation.
*/
function dispatchFromToolResult(toolName, result, transportStatus) {
	const meta = asRecord(result._meta);
	if (result.isError === true) {
		const metaStatus = meta?.[MCP_STATUS_META_KEY];
		const status = typeof metaStatus === "number" ? metaStatus : 500;
		const error = asRecord(meta?.[MCP_ERROR_META_KEY]);
		if (error && typeof error.code === "string") return {
			status,
			transportStatus,
			envelope: {
				ok: false,
				error
			}
		};
		return {
			status,
			transportStatus,
			envelope: {
				ok: false,
				error: {
					code: "mcp_tool_error",
					message: toolResultText(result) || `Tool "${toolName}" reported an error.`
				}
			}
		};
	}
	const status = typeof meta?.[MCP_STATUS_META_KEY] === "number" ? meta[MCP_STATUS_META_KEY] : 200;
	if ("structuredContent" in result) return {
		status,
		transportStatus,
		envelope: {
			ok: true,
			data: result.structuredContent
		}
	};
	const text = toolResultText(result);
	try {
		return {
			status,
			transportStatus,
			envelope: {
				ok: true,
				data: text === "" ? void 0 : JSON.parse(text)
			}
		};
	} catch {
		return {
			status,
			transportStatus,
			envelope: {
				ok: true,
				data: text
			}
		};
	}
}
function toolResultText(result) {
	if (!Array.isArray(result.content)) return "";
	return result.content.map((entry) => {
		const block = asRecord(entry);
		return block && block.type === "text" && typeof block.text === "string" ? block.text : "";
	}).filter((text) => text !== "").join("\n");
}
/** Turn a non-200 answer from the MCP endpoint into something a scenario author can act on. */
function describeMcpEndpointStatus(endpoint, response) {
	const detail = snippet(response.bodyText);
	switch (response.status) {
		case 401: return `${endpoint} returned 401 — the MCP endpoint requires authorization. Set \`"mcpHeaders": { "authorization": "Bearer ..." }\` on the scenario so the token is sent during initialization and every later request. ` + detail;
		case 404: return `${endpoint} returned 404 — the app does not serve remote MCP there. Enable it with \`defineApp({ agents: { mcp: {} } })\`, or point the scenario at the right path with "mcpPath".`;
		case 403:
			if (asRecord(response.body)?.error === "insufficient_scope") return `${endpoint} returned 403 insufficient_scope — the bearer token lacks one or more required OAuth scopes. Obtain a token with the scopes named by the challenge and update "mcpHeaders". ${detail}`;
			return `${endpoint} returned 403 — the MCP projection refuses browser-originated and cookie-authenticated requests. Remove any "cookie"/"origin" step headers. ${detail}`;
		case 405: return `${endpoint} returned 405 — that path does not accept the JSON-RPC POST an MCP client makes. ${detail}`;
		default: return `${endpoint} answered ${response.status} for a JSON-RPC POST. ${detail}`;
	}
}
function describeToolCallRejection(capability, toolName, error) {
	const described = describeJsonRpcError(error);
	if (/unknown tool/i.test(described)) return `the app's MCP endpoint does not serve a tool for capability "${capability}" (expected "${toolName}"). Give the capability \`expose: { mcp: true }\`. If it is destructive, also configure \`agents.mcp.destructive\`, a confirmation secret, and a registered approval store; otherwise run this step over the default "http" transport. Server said: ${described}`;
	return `tools/call for "${toolName}" was rejected: ${described}`;
}
function describeJsonRpcError(error) {
	const record = asRecord(error);
	if (!record) return JSON.stringify(error);
	return `JSON-RPC ${typeof record.code === "number" ? record.code : "?"}: ${typeof record.message === "string" ? record.message : JSON.stringify(record)}`;
}
function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function snippet(text) {
	const trimmed = text.trim();
	if (trimmed === "") return "";
	return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}
/**
* Poll a base URL until the server answers. Any HTTP response counts as
* ready — 404s included — because reachability is all the scenario runner
* needs before it starts dispatching capability calls.
*/
async function waitForServer(baseUrl, options = {}) {
	const { timeoutMs = 3e4, intervalMs = 250, earlyExit, fetchImpl = fetch } = options;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const abortReason = earlyExit?.();
		if (abortReason) return {
			ok: false,
			reason: abortReason
		};
		try {
			await fetchImpl(baseUrl, { signal: AbortSignal.timeout(2e3) });
			return { ok: true };
		} catch {
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}
	}
	return {
		ok: false,
		reason: `no response from ${baseUrl} within ${timeoutMs}ms`
	};
}
//#endregion
export { waitForServer as i, parseScenario as n, runScenario as r, findEvalFiles as t };
