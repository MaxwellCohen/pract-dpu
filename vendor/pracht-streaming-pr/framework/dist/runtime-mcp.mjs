import { resolveMcpEndpoint } from "./mcp-config.mjs";
import { handleCapabilityRequest, setActiveCapabilityHost } from "./runtime-capabilities.mjs";
import { CONFIRMATION_HEADER, MCP_CAPABILITY_META_KEY, MCP_CONFIRMATION_META_KEY, MCP_CONFIRMATION_META_KEY as MCP_CONFIRMATION_META_KEY$1, MCP_EFFECT_META_KEY, MCP_ERROR_META_KEY, MCP_LATEST_PROTOCOL_VERSION, MCP_LATEST_PROTOCOL_VERSION as MCP_LATEST_PROTOCOL_VERSION$1, MCP_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSIONS as MCP_PROTOCOL_VERSIONS$1, MCP_PROTOCOL_VERSION_HEADER, MCP_PROTOCOL_VERSION_HEADER as MCP_PROTOCOL_VERSION_HEADER$1, MCP_STATUS_META_KEY, MCP_TOOL_NAME_ERROR, findMcpToolNameCollisions, isValidMcpToolName, mcpToolName } from "@pracht/capabilities";
//#region src/runtime-mcp.ts
/**
* Remote MCP projection: stateless Streamable HTTP over the capability graph.
*
* This module is a *transport adapter*, not a second dispatch path. It parses
* JSON-RPC, projects `expose.mcp` capabilities into `tools/list`, and hands
* `tools/call` to `handleCapabilityRequest()` — the exact function the
* generated `/api/capabilities/*` endpoints use. Input validation, named
* middleware, Web Bot Auth policy, output validation, and audit events are
* therefore identical across HTTP, WebMCP, and MCP by construction; there is
* no enforcement in this file to drift.
*
* Stateless by design: no session id, no server→client stream, no
* resumability. That is the profile the Node, Cloudflare, and Vercel adapters
* already serve, and what the MCP stateless core allows.
*
* Serving is opt-in via `defineApp({ agents: { mcp: {} } })`; apps that do not
* configure it never reach this module.
*/
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;
/** Normalize an incoming MCP request path without retaining protocol helpers in unrelated apps. */
function normalizeMcpRequestPath(path) {
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
/** Capabilities the MCP projection serves, in graph order. */
function mcpExposedCapabilities(capabilities) {
	return capabilities.filter((entry) => entry.capability.expose?.mcp === true && entry.capability.effect !== "destructive");
}
/**
* Handle one request to the MCP endpoint. Always resolves — protocol problems
* become JSON-RPC errors, capability problems become tool errors.
*/ async function handleMcpRequest(options) {
	const { request } = options;
	if (request.method.toUpperCase() !== "POST") return new Response("Method Not Allowed", {
		status: 405,
		headers: {
			allow: "POST",
			"content-type": "text/plain; charset=utf-8"
		}
	});
	if (!isNonBrowserRequest(request)) return new Response("Browser-originated requests are not allowed", {
		status: 403,
		headers: { "content-type": "text/plain; charset=utf-8" }
	});
	if (request.headers.has("cookie")) return new Response("Cookie-authenticated requests are not allowed", {
		status: 403,
		headers: { "content-type": "text/plain; charset=utf-8" }
	});
	const declaredVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER$1);
	let activeVersion = declaredVersion && isSupportedProtocolVersion(declaredVersion) ? declaredVersion : MCP_LATEST_PROTOCOL_VERSION$1;
	const respond = (status, payload) => jsonRpcResponse(status, activeVersion, payload);
	if (declaredVersion && !isSupportedProtocolVersion(declaredVersion)) return respond(400, {
		jsonrpc: "2.0",
		id: null,
		error: {
			code: JSONRPC_INVALID_REQUEST,
			message: `Unsupported MCP protocol version ${JSON.stringify(declaredVersion)}. Supported: ${MCP_PROTOCOL_VERSIONS$1.join(", ")}.`
		}
	});
	if (!acceptsJson(request)) return respond(406, {
		jsonrpc: "2.0",
		id: null,
		error: {
			code: JSONRPC_INVALID_REQUEST,
			message: "Client must accept application/json."
		}
	});
	let payload;
	try {
		payload = JSON.parse(await request.text());
	} catch {
		return respond(400, {
			jsonrpc: "2.0",
			id: null,
			error: {
				code: JSONRPC_PARSE_ERROR,
				message: "Parse error."
			}
		});
	}
	if (Array.isArray(payload)) return respond(400, {
		jsonrpc: "2.0",
		id: null,
		error: {
			code: JSONRPC_INVALID_REQUEST,
			message: "JSON-RPC batching is not supported."
		}
	});
	const message = payload;
	if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") return respond(400, {
		jsonrpc: "2.0",
		id: null,
		error: {
			code: JSONRPC_INVALID_REQUEST,
			message: "Invalid JSON-RPC 2.0 request."
		}
	});
	if (message.id === void 0) return new Response(null, { status: 202 });
	if (typeof message.id !== "string" && typeof message.id !== "number") return respond(400, {
		jsonrpc: "2.0",
		id: null,
		error: {
			code: JSONRPC_INVALID_REQUEST,
			message: "Invalid JSON-RPC 2.0 request id."
		}
	});
	const id = message.id;
	if (options.resolutionError !== void 0) return respond(200, {
		jsonrpc: "2.0",
		id,
		error: {
			code: JSONRPC_INTERNAL_ERROR,
			message: `Capability registry failed to resolve${options.exposeErrors && options.resolutionError instanceof Error ? `: ${options.resolutionError.message}` : "."}`
		}
	});
	const exposedCapabilities = mcpExposedCapabilities(options.capabilities);
	const invalidToolNames = exposedCapabilities.filter((entry) => !isValidMcpToolName(mcpToolName(entry.name)));
	if (invalidToolNames.length > 0) return respond(200, {
		jsonrpc: "2.0",
		id,
		error: {
			code: JSONRPC_INTERNAL_ERROR,
			message: `${MCP_TOOL_NAME_ERROR}: ` + invalidToolNames.map((entry) => `${entry.name} → ${mcpToolName(entry.name)}`).join("; ")
		}
	});
	const collisions = findMcpToolNameCollisions(exposedCapabilities.map((entry) => entry.name));
	if (collisions.length > 0) return respond(200, {
		jsonrpc: "2.0",
		id,
		error: {
			code: JSONRPC_INTERNAL_ERROR,
			message: "Capability names collide as MCP tool names: " + collisions.map((collision) => `${collision.capabilities.join(" / ")} → ${collision.toolName}`).join("; ")
		}
	});
	switch (message.method) {
		case "initialize": {
			const params = readInitializeParams(message.params);
			if (!params) return respond(200, {
				jsonrpc: "2.0",
				id,
				error: {
					code: JSONRPC_INVALID_PARAMS,
					message: "initialize requires a string protocolVersion, object capabilities, and clientInfo with string name and version."
				}
			});
			activeVersion = negotiateProtocolVersion(params.protocolVersion);
			return respond(200, {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: activeVersion,
					capabilities: { tools: { listChanged: false } },
					serverInfo: options.mcp.serverInfo ?? {
						name: "pracht",
						version: "0.0.0"
					},
					instructions: options.mcp.instructions
				}
			});
		}
		case "ping": return respond(200, {
			jsonrpc: "2.0",
			id,
			result: {}
		});
		case "tools/list": return respond(200, {
			jsonrpc: "2.0",
			id,
			result: { tools: mcpExposedCapabilities(options.capabilities).map(toolDescriptor) }
		});
		case "tools/call": return handleToolsCall(options, id, message.params, activeVersion);
		default: return respond(200, {
			jsonrpc: "2.0",
			id,
			error: {
				code: JSONRPC_METHOD_NOT_FOUND,
				message: `Method not found: ${message.method}`
			}
		});
	}
}
function toolDescriptor(entry) {
	const { capability } = entry;
	return {
		name: mcpToolName(entry.name),
		title: capability.title,
		description: capability.description,
		inputSchema: capability.input,
		outputSchema: capability.output,
		annotations: {
			readOnlyHint: capability.effect === "read",
			...capability.effect === "read" ? { destructiveHint: false } : {},
			idempotentHint: capability.effect === "read"
		},
		_meta: {
			[MCP_CAPABILITY_META_KEY]: entry.name,
			[MCP_EFFECT_META_KEY]: capability.effect
		}
	};
}
async function handleToolsCall(options, id, rawParams, protocolVersion) {
	const params = rawParams ?? {};
	if (typeof params.name !== "string") return jsonRpcResponse(200, protocolVersion, {
		jsonrpc: "2.0",
		id,
		error: {
			code: JSONRPC_INVALID_PARAMS,
			message: "tools/call requires a string `name`."
		}
	});
	if (params.arguments !== void 0 && (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments))) return jsonRpcResponse(200, protocolVersion, {
		jsonrpc: "2.0",
		id,
		error: {
			code: JSONRPC_INVALID_PARAMS,
			message: "tools/call `arguments` must be an object when provided."
		}
	});
	const exposed = mcpExposedCapabilities(options.capabilities);
	const match = exposed.find((entry) => mcpToolName(entry.name) === params.name);
	if (!match) return jsonRpcResponse(200, protocolVersion, {
		jsonrpc: "2.0",
		id,
		error: {
			code: JSONRPC_INVALID_PARAMS,
			message: `Unknown tool ${JSON.stringify(params.name)}. Known tools: ${exposed.map((entry) => mcpToolName(entry.name)).join(", ") || "(none)"}.`
		}
	});
	const capabilityRequest = synthesizeCapabilityRequest(options, match, params.arguments, params._meta);
	setActiveCapabilityHost(capabilityRequest, options.app, options.registry, "mcp", options.onAudit, options.agent ?? null);
	const capabilityUrl = new URL(capabilityRequest.url);
	const response = await handleCapabilityRequest({
		match,
		context: options.context,
		registry: options.registry,
		request: capabilityRequest,
		url: capabilityUrl,
		pathname: capabilityUrl.pathname,
		exposeErrors: options.exposeErrors,
		apiMiddlewareFiles: options.apiMiddlewareFiles,
		agents: options.agents,
		agent: options.agent ?? null,
		transport: "mcp",
		onAudit: options.onAudit
	});
	let envelope;
	try {
		const parsed = await response.json();
		if (!isCapabilityEnvelope(parsed)) throw new Error("Response is not a capability envelope.");
		envelope = parsed;
	} catch {
		envelope = {
			ok: false,
			error: {
				code: "middleware_rejected",
				message: `Capability "${match.name}" was rejected before it ran (status ${response.status}).`
			}
		};
	}
	return jsonRpcResponse(200, protocolVersion, {
		jsonrpc: "2.0",
		id,
		result: toolResult(match, envelope, response.status)
	});
}
/**
* Build the request the HTTP projection would have received.
*
* The header policy is a security decision, not plumbing: `cookie` is
* deliberately **not** copied, so a browser session cookie can never
* authenticate the remote agent transport — the rule becomes a mechanism
* rather than a convention. `authorization` is forwarded so middleware sees
* the MCP credential.
*/
function synthesizeCapabilityRequest(options, match, args, meta) {
	const headers = new Headers({ "content-type": "application/json" });
	const authorization = options.request.headers.get("authorization");
	if (authorization) headers.set("authorization", authorization);
	const confirmation = meta?.[MCP_CONFIRMATION_META_KEY$1];
	if (typeof confirmation === "string" && confirmation !== "") headers.set(CONFIRMATION_HEADER, confirmation);
	const path = match.httpPath ?? `/__pracht/mcp/tools/${mcpToolName(match.name)}`;
	return new Request(new URL(path, options.url.origin).href, {
		method: "POST",
		headers,
		body: JSON.stringify(args ?? {})
	});
}
/**
* Envelope → MCP tool result.
*
* Execution failures stay `isError: true` results rather than JSON-RPC errors:
* the call itself succeeded, and the model needs to *read* the failure to
* react to it.
*/
function toolResult(match, envelope, status) {
	if (envelope.ok) return {
		content: [{
			type: "text",
			text: JSON.stringify(envelope.data, null, 2)
		}],
		structuredContent: envelope.data,
		isError: false,
		_meta: { [MCP_CAPABILITY_META_KEY]: match.name }
	};
	const { error } = envelope;
	const lines = [`${error.code}: ${error.message}`];
	if (error.issues?.length) lines.push(...error.issues.map((issue) => `- ${issue.path || "(root)"}: ${issue.message}`));
	return {
		content: [{
			type: "text",
			text: lines.join("\n")
		}],
		isError: true,
		_meta: {
			[MCP_CAPABILITY_META_KEY]: match.name,
			[MCP_STATUS_META_KEY]: status,
			[MCP_ERROR_META_KEY]: {
				code: error.code,
				message: error.message,
				...error.issues ? { issues: error.issues } : {}
			}
		}
	};
}
function isSupportedProtocolVersion(version) {
	return MCP_PROTOCOL_VERSIONS$1.includes(version);
}
function isCapabilityEnvelope(value) {
	if (!value || typeof value !== "object") return false;
	const candidate = value;
	if (candidate.ok === true) return "data" in candidate;
	if (candidate.ok !== false || !candidate.error || typeof candidate.error !== "object") return false;
	if (typeof candidate.error.code !== "string" || typeof candidate.error.message !== "string") return false;
	return candidate.error.issues === void 0 || Array.isArray(candidate.error.issues) && candidate.error.issues.every((issue) => !!issue && typeof issue.path === "string" && typeof issue.message === "string");
}
function negotiateProtocolVersion(requested) {
	return typeof requested === "string" && isSupportedProtocolVersion(requested) ? requested : MCP_LATEST_PROTOCOL_VERSION$1;
}
function readInitializeParams(value) {
	if (!isObjectRecord(value)) return null;
	const { protocolVersion, capabilities, clientInfo } = value;
	if (typeof protocolVersion !== "string" || !isObjectRecord(capabilities)) return null;
	if (!isObjectRecord(clientInfo) || typeof clientInfo.name !== "string" || clientInfo.name.trim() === "" || typeof clientInfo.version !== "string" || clientInfo.version.trim() === "") return null;
	return {
		protocolVersion,
		capabilities,
		clientInfo: {
			name: clientInfo.name,
			version: clientInfo.version
		}
	};
}
function isObjectRecord(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function acceptsJson(request) {
	const accept = request.headers.get("accept");
	if (!accept) return true;
	return accept.includes("application/json") || accept.includes("*/*");
}
/** Reject browser fetches/forms; remote MCP clients send neither header. */
function isNonBrowserRequest(request) {
	return !request.headers.has("origin") && !request.headers.has("sec-fetch-site");
}
function jsonRpcResponse(status, protocolVersion, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			[MCP_PROTOCOL_VERSION_HEADER$1]: protocolVersion
		}
	});
}
//#endregion
export { MCP_CONFIRMATION_META_KEY, MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSION_HEADER, handleMcpRequest, mcpExposedCapabilities, normalizeMcpRequestPath, resolveMcpEndpoint };
