import { formatUnknownNameError } from "./name-suggestions.mjs";
import { CONFIRMATION_HEADER as CONFIRMATION_HEADER$1, CONFIRMATION_SECRET_ENV, canonicalJson, consumeConfirmationToken, createConfirmationToken, resolveConfirmationSecret, sha256Base64Url, verifyConfirmationToken } from "./runtime-confirmation.mjs";
import { capabilityApprovalId, resolveCapabilityApprovalPrincipal, resolveCapabilityApprovalStore } from "./runtime-approval.mjs";
import { bindAgentContext, rebindMcpTokenContext, snapshotAgentIdentity } from "./runtime-agent-context.mjs";
import { resolveRegistryModule } from "./runtime-manifest.mjs";
import { runMiddlewareChain } from "./runtime-middleware.mjs";
import { CAPABILITY_EFFECT_HEADER, CAPABILITY_HTTP_PREFIX, CAPABILITY_TRANSPORT_HEADER, DEFAULT_MCP_ENDPOINT, MCP_CONFIRMATION_META_KEY, MCP_SCHEMA_ROOT_ERROR, MCP_TOOL_NAME_ERROR, WEBMCP_TOOL_NAME_ERROR, capabilityHttpPath, coerceFormInput, isValidCapabilityHttpPath, isValidMcpToolName, isValidWebmcpToolName, mcpToolName, normalizeCapabilityHttpPath } from "@pracht/capabilities";
//#region src/runtime-capabilities.ts
/**
* Capability registry and execution pipeline.
*
* Capabilities are registered in the app manifest (like shells/middleware)
* and executed through one pipeline regardless of how they are invoked:
*
*   input validation → named middleware chain → run() → output validation
*
* Both the generated HTTP projection (`handlePrachtRequest`) and direct
* server-side use (`invokeCapability`) call the same pipeline, so business
* rules can never diverge between transports. Capabilities are private by
* default — only `expose.http` makes one reachable over the network.
*/
/** Longest a capability may run before its signal aborts, matching API routes. */
const CAPABILITY_TIMEOUT_MS = 3e4;
/** Names must be URL-safe: dot-separated segments of [a-z0-9_-]. */
const CAPABILITY_NAME_RE = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i;
const resolvedCapabilitiesCache = /* @__PURE__ */ new WeakMap();
const EMPTY_CAPABILITY_MODULES = {};
function resolveAppCapabilities(app, registry) {
	const capabilityModules = registry.capabilityModules ?? EMPTY_CAPABILITY_MODULES;
	let registryCache = resolvedCapabilitiesCache.get(app);
	if (!registryCache) {
		registryCache = /* @__PURE__ */ new WeakMap();
		resolvedCapabilitiesCache.set(app, registryCache);
	}
	let resolved = registryCache.get(capabilityModules);
	if (!resolved) {
		resolved = resolveAppCapabilitiesUncached(app, registry);
		registryCache.set(capabilityModules, resolved);
	}
	return resolved;
}
async function resolveAppCapabilitiesUncached(app, registry) {
	const resolved = [];
	const seenHttpPaths = /* @__PURE__ */ new Map();
	const mcpEndpoint = app.agents?.mcp ? normalizeCapabilityHttpPath(app.agents.mcp.path ?? DEFAULT_MCP_ENDPOINT) : null;
	for (const [name, file] of Object.entries(app.capabilities ?? {})) {
		if (!CAPABILITY_NAME_RE.test(name)) throw new Error(`Invalid capability name "${name}". Names must be dot-separated segments of letters, numbers, hyphens, and underscores (e.g. "notes.search").`);
		const capability = (await resolveRegistryModule(registry.capabilityModules, file))?.default;
		if (!capability || capability.kind !== "capability") throw new Error(`Capability "${name}" (${file}) must default-export the result of defineCapability() from @pracht/capabilities.`);
		if (capability.effect === "destructive" && capability.expose?.webmcp) throw new Error(`Capability "${name}": destructive capabilities cannot be exposed as WebMCP page tools — use expose.http, or expose.mcp with agents.mcp.destructive.`);
		if (capability.expose?.webmcp && !capability.expose.http) throw new Error(`Capability "${name}": expose.webmcp requires expose.http.`);
		if (capability.expose?.webmcp && !isValidWebmcpToolName(name)) throw new Error(`Capability "${name}": ${WEBMCP_TOOL_NAME_ERROR}.`);
		if (capability.expose?.mcp && (capability.input?.type !== "object" || capability.output?.type !== "object")) throw new Error(`Capability "${name}": ${MCP_SCHEMA_ROOT_ERROR}.`);
		if (capability.expose?.mcp && !isValidMcpToolName(mcpToolName(name))) throw new Error(`Capability "${name}": ${MCP_TOOL_NAME_ERROR}.`);
		if (capability.expose && (typeof capability.validateInput !== "function" || typeof capability.validateOutput !== "function" || typeof capability.description !== "string" || !capability.input || !capability.output || !capability.effect)) throw new Error(`Capability "${name}" is exposed but is missing its contract (description, input schema, output schema, effect, validators).`);
		const middlewareFiles = (capability.middleware ?? []).map((middlewareName) => {
			const middlewareFile = app.middleware?.[middlewareName];
			if (!middlewareFile) throw new Error(formatUnknownNameError({
				kind: "middleware",
				kindPlural: "middleware",
				name: middlewareName,
				registered: Object.keys(app.middleware ?? {}),
				context: `capability "${name}"`
			}));
			return middlewareFile;
		});
		let httpPath = null;
		if (capability.expose?.http) {
			const configuredPath = capability.expose.http.path ?? capabilityHttpPath(name);
			if (!isValidCapabilityHttpPath(configuredPath)) throw new Error(`Capability "${name}": HTTP exposure path must be an exact same-origin pathname starting with "/".`);
			httpPath = normalizeCapabilityHttpPath(configuredPath);
			if (httpPath === mcpEndpoint) throw new Error(`Capability "${name}" exposes HTTP path "${httpPath}", which is also the configured MCP endpoint. Choose a distinct agents.mcp.path or capability HTTP path.`);
			const existing = seenHttpPaths.get(httpPath);
			if (existing) throw new Error(`Capabilities "${existing}" and "${name}" both expose HTTP path "${httpPath}".`);
			seenHttpPaths.set(httpPath, name);
		}
		resolved.push({
			name,
			file,
			capability,
			httpPath,
			middlewareFiles
		});
	}
	return resolved;
}
function matchCapabilityRoute(capabilities, pathname) {
	const normalized = normalizeCapabilityHttpPath(pathname);
	return capabilities.find((entry) => entry.httpPath === normalized);
}
/**
* Best-effort path discovery used only after full registry resolution fails.
* It recognizes valid capability modules independently so custom HTTP paths
* still fail closed instead of falling through to an unrelated page route.
*/
async function isRegisteredCapabilityHttpPath(app, registry, pathname) {
	const normalized = normalizeCapabilityHttpPath(pathname);
	for (const [name, file] of Object.entries(app.capabilities ?? {})) try {
		const capability = (await resolveRegistryModule(registry.capabilityModules, file))?.default;
		if (capability?.kind !== "capability" || !capability.expose?.http) continue;
		if (normalizeCapabilityHttpPath(capability.expose.http.path ?? capabilityHttpPath(name)) === normalized) return true;
	} catch {}
	return false;
}
/**
* Run one capability through validation, middleware, and execution. The
* middleware chain wraps the terminal exactly like page/API middleware does
* (same `runMiddlewareChain`), so `next()`, context mutation, and
* short-circuit semantics are identical everywhere.
*/
async function runCapabilityPipeline(options) {
	const { capability, name, middlewareFiles } = options.resolved;
	const validatedInput = capability.validateInput(options.input);
	if (!validatedInput.ok) {
		const envelope = errorEnvelope({
			code: "invalid_input",
			message: `Invalid input for capability "${name}".`,
			issues: validatedInput.issues
		});
		return {
			kind: "envelope",
			status: 400,
			envelope,
			response: envelopeResponse(400, envelope)
		};
	}
	const syntheticRoute = capabilityMiddlewareRoute(options.resolved);
	const holder = { settled: null };
	let terminalResponse = null;
	const terminal = async () => {
		if (options.beforeRun) {
			const gate = await options.beforeRun(validatedInput.value);
			if (gate) {
				holder.settled = {
					status: gate.status,
					envelope: gate.envelope
				};
				terminalResponse = envelopeResponse(gate.status, gate.envelope);
				return terminalResponse;
			}
		}
		let output;
		try {
			output = await capability.run({
				input: validatedInput.value,
				context: options.context,
				request: options.request,
				signal: options.signal
			});
		} catch (error) {
			holder.settled = {
				status: 500,
				envelope: errorEnvelope({
					code: "internal_error",
					message: options.exposeErrors ? `Capability "${name}" failed: ${error instanceof Error ? error.message : String(error)}` : "Capability failed."
				})
			};
			terminalResponse = envelopeResponse(holder.settled.status, holder.settled.envelope);
			return terminalResponse;
		}
		const validatedOutput = capability.validateOutput(output);
		if (!validatedOutput.ok) {
			holder.settled = {
				status: 500,
				envelope: errorEnvelope({
					code: "invalid_output",
					message: options.exposeErrors ? `Capability "${name}" produced output that does not match its output schema.` : "Capability failed.",
					issues: options.exposeErrors ? validatedOutput.issues : void 0
				})
			};
			terminalResponse = envelopeResponse(holder.settled.status, holder.settled.envelope);
			return terminalResponse;
		}
		holder.settled = {
			status: 200,
			envelope: {
				ok: true,
				data: validatedOutput.value
			}
		};
		terminalResponse = envelopeResponse(holder.settled.status, holder.settled.envelope);
		return terminalResponse;
	};
	const response = await runMiddlewareChain({
		context: options.context,
		middlewareFiles,
		params: {},
		pathname: options.pathname,
		registry: options.registry,
		request: options.request,
		route: syntheticRoute,
		signal: options.signal,
		url: options.url,
		terminal
	});
	if (holder.settled && (response === terminalResponse || await responseMatchesEnvelope(response, holder.settled))) return {
		kind: "envelope",
		...holder.settled,
		response
	};
	return {
		kind: "short-circuit",
		response
	};
}
async function responseMatchesEnvelope(response, settled) {
	if (response.status !== settled.status) return false;
	if (!response.headers.get("content-type")?.includes("application/json")) return false;
	try {
		return canonicalJson(await response.clone().json()) === canonicalJson(settled.envelope);
	} catch {
		return false;
	}
}
let capabilityAuditHook = null;
const capabilityAuditListeners = /* @__PURE__ */ new Map();
function setCapabilityAuditHook(hook) {
	capabilityAuditHook = hook;
}
/**
* Register an additional audit sink under a stable name, without displacing
* the single-slot hook or any differently-named sink. Registering the same
* name again replaces that sink — which is what makes the API safe to call
* from module scope under dev HMR.
*
* Returns an unsubscribe function. It is idempotent, and it deliberately only
* removes *its own* registration: after a reload replaced the name, a stale
* closure's unsubscribe must not delete the live sink.
*/
function addCapabilityAuditListener(name, hook) {
	const registration = { hook };
	capabilityAuditListeners.set(name, registration);
	return () => {
		if (capabilityAuditListeners.get(name) === registration) capabilityAuditListeners.delete(name);
	};
}
/** Test/teardown helper — drops every additive sink. */
function clearCapabilityAuditListeners() {
	capabilityAuditListeners.clear();
}
const warnedAuditSinks = /* @__PURE__ */ new WeakSet();
/**
* Deliver one event to one sink. Exceptions are swallowed — an observer must
* never fail a capability call — but the first failure *from that sink* is
* reported so a broken sink is not invisible. Later failures from the same
* sink stay quiet rather than emitting a line per capability call.
*/
function deliverCapabilityAudit(label, hook, snapshot, warningKey) {
	if (!hook) return;
	const sinkKey = warningKey ?? hook;
	try {
		hook(snapshot);
	} catch (error) {
		if (warnedAuditSinks.has(sinkKey)) return;
		warnedAuditSinks.add(sinkKey);
		try {
			console.warn(`[pracht] Capability audit sink ${JSON.stringify(label)} threw and was ignored: ${describeCapabilityAuditError(error)}. Audit sinks must never throw; further failures from this sink are not reported.`);
		} catch {}
	}
}
function describeCapabilityAuditError(error) {
	try {
		return error instanceof Error ? error.message : String(error);
	} catch {
		return "<unprintable error>";
	}
}
/** Audit hooks observe; they must never break a request. */
function emitCapabilityAudit(event, extra) {
	const snapshot = Object.freeze({
		...event,
		agent: snapshotAgentIdentity(event.agent)
	});
	const singleSlotHook = capabilityAuditHook;
	const listeners = Array.from(capabilityAuditListeners);
	deliverCapabilityAudit("setCapabilityAuditHook", singleSlotHook, snapshot);
	for (const [name, registration] of listeners) deliverCapabilityAudit(name, registration.hook, snapshot, registration);
	deliverCapabilityAudit("onCapabilityAudit", extra, snapshot);
}
/**
* Handle a matched capability HTTP request. Method/CSRF checks already ran in
* `handlePrachtRequest`. Always answers with the typed envelope, except for
* middleware redirects (3xx pass through untouched). Emits one audit event
* per dispatch (principal, capability, effect, outcome, duration).
*/
async function handleCapabilityRequest(options) {
	const started = performance.now();
	let dispatched = await dispatchCapabilityHttpWithApiMiddleware(options);
	if (options.transport === "mcp") dispatched = await revalidateMcpSuccessEnvelope(options, dispatched);
	const { response, outcome } = dispatched;
	const responseWithEffect = withCapabilityEffect(response, options.match.capability.effect);
	emitCapabilityAudit({
		capability: options.match.name,
		effect: options.match.capability.effect,
		transport: capabilityTransport(options.request.headers.get(CAPABILITY_TRANSPORT_HEADER), options.transport),
		via: null,
		outcome,
		status: responseWithEffect.status,
		durationMs: performance.now() - started,
		agent: options.agent ?? null
	}, options.onAudit);
	return responseWithEffect;
}
/**
* MCP advertises the capability's output schema in `tools/list`. Middleware
* can short-circuit with its own success envelope before the capability
* pipeline validates output, so validate that envelope before the audit event
* and status are finalized. The MCP adapter can then translate the same
* settled response without making its audit trail disagree with the client.
*/
async function revalidateMcpSuccessEnvelope(options, dispatched) {
	if (!dispatched.outcome.startsWith("middleware_")) return dispatched;
	let parsed;
	try {
		parsed = await dispatched.response.clone().json();
	} catch {
		return dispatched;
	}
	if (!parsed || typeof parsed !== "object" || parsed.ok !== true || !("data" in parsed)) return dispatched;
	const validatedOutput = options.match.capability.validateOutput(parsed.data);
	const headers = new Headers(dispatched.response.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	headers.delete("content-length");
	if (validatedOutput.ok) return {
		response: new Response(JSON.stringify({
			ok: true,
			data: validatedOutput.value
		}), {
			status: dispatched.response.status,
			headers
		}),
		outcome: dispatched.outcome
	};
	return audited(new Response(JSON.stringify(errorEnvelope({
		code: "invalid_output",
		message: options.exposeErrors ? `Capability "${options.match.name}" produced output that does not match its output schema.` : "Capability failed.",
		issues: options.exposeErrors ? validatedOutput.issues : void 0
	})), {
		status: 500,
		headers
	}), "invalid_output");
}
/**
* Capability endpoints are part of the application's HTTP API surface, so the
* app-level API middleware chain wraps the complete dispatch. This deliberately
* stays outside `runCapabilityPipeline`: direct server invocation should run
* capability middleware, but must not inherit HTTP-only API policy.
*/
async function dispatchCapabilityHttpWithApiMiddleware(options) {
	const middlewareFiles = options.apiMiddlewareFiles ?? [];
	if (middlewareFiles.length === 0) return dispatchCapabilityHttp(options);
	const holder = { dispatched: null };
	try {
		const response = await runMiddlewareChain({
			context: options.context,
			middlewareFiles,
			params: {},
			pathname: options.pathname,
			registry: options.registry,
			request: options.request,
			route: capabilityMiddlewareRoute(options.match),
			signal: AbortSignal.timeout(CAPABILITY_TIMEOUT_MS),
			url: options.url,
			terminal: async () => {
				holder.dispatched = await dispatchCapabilityHttp(options);
				return holder.dispatched.response;
			}
		});
		const dispatched = holder.dispatched;
		if (dispatched && response === dispatched.response) return dispatched;
		const normalized = normalizeMiddlewareShortCircuit(response);
		return audited(normalized, `middleware_${normalized.status}`);
	} catch (error) {
		return audited(capabilityInternalErrorResponse(options, error), "internal_error");
	}
}
function capabilityTransport(marker, trustedTransport) {
	if (trustedTransport === "mcp") return "mcp";
	if (marker === "webmcp") return "webmcp";
	return "http";
}
function capabilityMiddlewareRoute(resolved) {
	return {
		path: resolved.httpPath ?? `capability:${resolved.name}`,
		file: resolved.file,
		segments: []
	};
}
function withCapabilityEffect(response, effect) {
	const headers = new Headers(response.headers);
	headers.set(CAPABILITY_EFFECT_HEADER, effect);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
}
async function dispatchCapabilityHttp(options) {
	const { capability, name } = options.match;
	if (options.request.method.toUpperCase() !== "POST") return audited(envelopeResponse(405, errorEnvelope({
		code: "method_not_allowed",
		message: `Capability "${name}" only accepts POST.`
	})), "method_not_allowed");
	if ((capability.agentPolicy ?? options.agents?.webBotAuth?.policy ?? "observe") === "require" && !options.agent) return audited(envelopeResponse(401, errorEnvelope({
		code: "agent_required",
		message: `Capability "${name}" requires a verified agent signature (Web Bot Auth).`
	})), "agent_required");
	let input = {};
	const contentType = options.request.headers.get("content-type") ?? "";
	const isFormPost = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
	if (isFormPost) try {
		const form = await options.request.formData();
		input = coerceFormInput(capability.input, form.entries());
	} catch {
		return audited(envelopeResponse(400, errorEnvelope({
			code: "invalid_json",
			message: "Request form body could not be parsed."
		})), "invalid_json");
	}
	else try {
		const body = await options.request.text();
		if (body.trim() !== "") input = JSON.parse(body);
	} catch {
		return audited(envelopeResponse(400, errorEnvelope({
			code: "invalid_json",
			message: "Request body must be valid JSON."
		})), "invalid_json");
	}
	try {
		const beforeRun = capability.effect === "destructive" ? async (validatedInput) => {
			const gate = await enforceDestructiveConfirmation(options, validatedInput);
			if (gate === null) markDestructiveConfirmed(options.request);
			return gate;
		} : void 0;
		const outcome = await runCapabilityPipeline({
			resolved: options.match,
			input,
			context: options.context,
			registry: options.registry,
			request: options.request,
			signal: AbortSignal.timeout(CAPABILITY_TIMEOUT_MS),
			url: options.url,
			pathname: options.pathname,
			exposeErrors: options.exposeErrors,
			beforeRun
		});
		if (outcome.kind === "envelope") {
			if (isFormPost && outcome.envelope.ok && (options.request.headers.get("accept") ?? "").includes("text/html")) {
				const back = sameOriginReferer(options.request, options.url);
				if (back) return audited(Response.redirect(back, 303), "ok");
			}
			return audited(outcome.response, envelopeOutcome(outcome.envelope));
		}
		const normalized = normalizeMiddlewareShortCircuit(outcome.response);
		return audited(normalized, `middleware_${normalized.status}`);
	} catch (error) {
		return audited(capabilityInternalErrorResponse(options, error), "internal_error");
	}
}
function capabilityInternalErrorResponse(options, error) {
	return envelopeResponse(500, errorEnvelope({
		code: "internal_error",
		message: options.exposeErrors ? `Capability "${options.match.name}" failed: ${error instanceof Error ? error.message : String(error)}` : "Capability failed."
	}));
}
function audited(response, outcome) {
	return {
		response,
		outcome
	};
}
/** Referer of a document form post, only when it stays on this origin. */
function sameOriginReferer(request, url) {
	const referer = request.headers.get("referer");
	if (!referer) return null;
	try {
		const parsed = new URL(referer);
		return parsed.origin === url.origin ? parsed.href : null;
	} catch {
		return null;
	}
}
function envelopeOutcome(envelope) {
	return envelope.ok ? "ok" : envelope.error.code;
}
/**
* Prepare/commit gate for destructive capability HTTP calls. Returns the
* envelope ending the request, or `null` when a valid confirmation token was
* presented and the capability may run. Runs as the pipeline's `beforeRun`
* hook — i.e. after named middleware — so rate limiting sees prepare and
* invalid-token attempts too. See runtime-confirmation.ts for the token
* construction and its documented replay limitations, and runtime-approval.ts
* for the durable store that removes them.
*/
async function enforceDestructiveConfirmation(options, validatedInput) {
	const secret = resolveConfirmationSecret();
	if (!secret) return {
		status: 403,
		envelope: errorEnvelope({
			code: "confirmation_unavailable",
			message: `Destructive capability "${options.match.name}" cannot run: no confirmation secret is configured (set ${CONFIRMATION_SECRET_ENV}).`
		})
	};
	const name = options.match.name;
	const store = resolveCapabilityApprovalStore();
	const mode = options.agents?.confirmation?.mode ?? "token";
	if (options.transport === "mcp" && !store) return {
		status: 403,
		envelope: errorEnvelope({
			code: "confirmation_unavailable",
			message: `Destructive capability "${name}" cannot run over remote MCP: no approval store is registered, so commits could not be made exactly-once (call setCapabilityApprovalStore() from a server-only module).`
		})
	};
	if (mode === "human" && !store) return {
		status: 403,
		envelope: errorEnvelope({
			code: "confirmation_unavailable",
			message: `Destructive capability "${name}" cannot run: agents.confirmation.mode is "human" but no approval store is registered (call setCapabilityApprovalStore() from a server-only module).`
		})
	};
	let principal;
	let confirmationPrincipal;
	try {
		const resolvedPrincipal = await resolveCapabilityApprovalPrincipal({
			context: options.context,
			request: options.request,
			capability: name,
			agent: options.agent ?? null,
			confirmationSecret: secret
		});
		principal = resolvedPrincipal?.record ?? "anonymous";
		confirmationPrincipal = resolvedPrincipal?.tokenBinding ?? "anonymous";
	} catch (error) {
		return {
			status: 403,
			envelope: errorEnvelope({
				code: "confirmation_unavailable",
				message: `Destructive capability "${name}" cannot run: the approval principal resolver failed` + (options.exposeErrors ? ` (${error instanceof Error ? error.message : String(error)}).` : ".")
			})
		};
	}
	if (mode === "human" && principal === "anonymous") return {
		status: 403,
		envelope: errorEnvelope({
			code: "confirmation_unavailable",
			message: `Destructive capability "${name}" cannot run in human approval mode without an authenticated principal (use Web Bot Auth or call setCapabilityApprovalPrincipalResolver() from a server-only module).`
		})
	};
	const canonicalInput = canonicalJson(validatedInput);
	const binding = {
		secret,
		principal: confirmationPrincipal,
		capability: name,
		canonicalInput,
		...store ? { approvalMode: mode } : {}
	};
	const presented = options.request.headers.get(CONFIRMATION_HEADER$1);
	const ttlSeconds = options.agents?.confirmation?.ttlSeconds ?? 120;
	const inputHash = store ? await sha256Base64Url(canonicalInput) : null;
	const approvalId = inputHash ? await capabilityApprovalId(secret, principal, name, inputHash, mode) : null;
	if (!presented) {
		let expiresAtLimit = 0;
		if (store && approvalId && inputHash) {
			const now = Math.floor(Date.now() / 1e3);
			const created = await withApprovalStore(name, options.exposeErrors, () => store.create({
				id: approvalId,
				principal,
				capability: name,
				inputHash,
				input: validatedInput,
				requiresApproval: mode === "human",
				createdAt: now,
				expiresAt: now + ttlSeconds,
				state: "pending",
				decidedBy: null,
				decidedAt: null
			}));
			if (!created.ok) return created.failure;
			if (created.value.state === "consumed" || created.value.state === "rejected") {
				const retryAfterSeconds = Math.max(1, created.value.expiresAt - now);
				return {
					status: 403,
					envelope: errorEnvelope({
						code: "confirmation_invalid",
						message: `Confirmation request rejected (${created.value.state === "consumed" ? "already_used" : "rejected"}): this exact operation was already decided and stays closed until its approval expires. Retry the same input in ${retryAfterSeconds}s, or call with different input.`,
						retryAfterSeconds
					})
				};
			}
			expiresAtLimit = created.value.expiresAt - now;
		}
		const { token, expiresAt } = await createConfirmationToken({
			...binding,
			ttlSeconds: store ? Math.max(1, expiresAtLimit) : ttlSeconds
		});
		const echo = options.transport === "mcp" ? `repeat the tools/call with identical arguments and the token in _meta["${MCP_CONFIRMATION_META_KEY}"]` : `repeat the call with identical input and the "${CONFIRMATION_HEADER$1}" header set to the confirmation token`;
		return {
			status: 409,
			envelope: errorEnvelope({
				code: "confirmation_required",
				message: mode === "human" ? `Capability "${name}" is destructive and needs human approval. Once the proposal is approved, ${echo}.` : `Capability "${name}" is destructive. To commit, ${echo}.`,
				confirmationToken: token,
				expiresAt,
				...approvalId ? { approvalId } : {}
			})
		};
	}
	const verification = await verifyConfirmationToken(presented, binding);
	if (!verification.ok) return {
		status: 403,
		envelope: errorEnvelope({
			code: "confirmation_invalid",
			message: `Confirmation token rejected (${verification.reason}).`
		})
	};
	if (store && approvalId) {
		const consumed = await withApprovalStore(name, options.exposeErrors, () => store.consume(approvalId));
		if (!consumed.ok) return consumed.failure;
		if (!consumed.value.ok) {
			if (consumed.value.reason === "awaiting_approval") return {
				status: 409,
				envelope: errorEnvelope({
					code: "confirmation_pending",
					message: `Capability "${name}" is awaiting human approval.`,
					approvalId
				})
			};
			return {
				status: 403,
				envelope: errorEnvelope({
					code: "confirmation_invalid",
					message: `Confirmation token rejected (${consumed.value.reason}).`
				})
			};
		}
		return null;
	}
	if (options.agents?.confirmation?.singleUse && !consumeConfirmationToken(verification.signature, verification.expiresAt)) return {
		status: 403,
		envelope: errorEnvelope({
			code: "confirmation_invalid",
			message: "Confirmation token rejected (already_used)."
		})
	};
	return null;
}
/**
* Approval stores talk to a database, so they can fail. A store that is down
* must never wave a destructive call through: any rejection becomes a closed
* gate.
*/
async function withApprovalStore(capability, exposeErrors, operation) {
	try {
		return {
			ok: true,
			value: await operation()
		};
	} catch (error) {
		return {
			ok: false,
			failure: {
				status: 403,
				envelope: errorEnvelope({
					code: "confirmation_unavailable",
					message: `Destructive capability "${capability}" cannot run: the approval store failed` + (exposeErrors ? ` (${error instanceof Error ? error.message : String(error)}).` : ".")
				})
			}
		};
	}
}
/**
* Middleware that returns without calling `next()` decides the response.
* Redirects and 2xx responses pass through untouched; error statuses are
* normalized into the envelope (status and headers preserved) so HTTP
* callers always receive the typed shape.
*/
function normalizeMiddlewareShortCircuit(response) {
	if (response.status < 400) return response;
	const code = middlewareErrorCode(response.status);
	const headers = new Headers(response.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	headers.delete("content-length");
	return new Response(JSON.stringify(errorEnvelope({
		code,
		message: `Request rejected by middleware (status ${response.status}).`
	})), {
		status: response.status,
		headers
	});
}
function middlewareErrorCode(status) {
	if (status === 401) return "unauthorized";
	if (status === 403) return "forbidden";
	if (status === 429) return "rate_limited";
	if (status >= 300 && status < 400) return "redirect";
	return "middleware_rejected";
}
const activeCapabilityHosts = /* @__PURE__ */ new WeakMap();
/**
* Record that the destructive dispatch on this request cleared prepare/commit,
* so capabilities it composes may perform destructive work too. Called only
* from the confirmation gate; there is no caller-reachable path to it.
*/
function markDestructiveConfirmed(request) {
	const host = activeCapabilityHosts.get(request);
	if (host) host.destructiveConfirmed = true;
}
/** End the destructive-composition grant when the confirmed dispatch settles. */
function clearDestructiveConfirmed(request) {
	const host = activeCapabilityHosts.get(request);
	if (host) host.destructiveConfirmed = false;
}
function setActiveCapabilityHost(request, app, registry, via = "http", onAudit, agent, tokenAuth, sharedRequest) {
	const sharedHost = sharedRequest ? activeCapabilityHosts.get(sharedRequest) : void 0;
	activeCapabilityHosts.set(request, sharedHost ?? {
		app,
		registry,
		via,
		onAudit,
		agent: snapshotAgentIdentity(agent ?? null),
		tokenAuth
	});
}
async function invokeCapability(name, input, ctx) {
	const host = activeCapabilityHosts.get(ctx.request);
	if (!host) throw new Error("invokeCapability() has no capability host for this request. It is only available while handlePrachtRequest() is serving requests (loaders, API routes, middleware). In tests, build a standalone host with createCapabilityTestHost() instead.");
	return invokeCapabilityOnHost(host, name, input, ctx);
}
/**
* Run one capability through the full dispatch pipeline against an explicit
* host. Shared by `invokeCapability()` (the request-bound host installed by
* `handlePrachtRequest`) and `createCapabilityTestHost()` (a synthetic host
* for tests).
*/
async function invokeCapabilityOnHost(host, name, input, ctx) {
	const capabilities = await resolveAppCapabilities(host.app, host.registry);
	const resolved = capabilities.find((entry) => entry.name === name);
	if (!resolved) return errorEnvelope({
		code: "unknown_capability",
		message: formatUnknownNameError({
			kind: "capability",
			kindPlural: "capabilities",
			name,
			registered: capabilities.map((entry) => entry.name)
		})
	});
	const started = performance.now();
	let context = ctx.context ?? {};
	let outcome;
	try {
		context = capabilityPipelineContext(host, ctx.context);
		outcome = mcpCompositionGuard(host, resolved) ?? await runCapabilityPipeline({
			resolved,
			input,
			context,
			registry: host.registry,
			request: ctx.request,
			signal: ctx.signal ?? AbortSignal.timeout(CAPABILITY_TIMEOUT_MS),
			url: new URL(ctx.request.url),
			exposeErrors: true
		});
	} catch (error) {
		const envelope = errorEnvelope({
			code: "internal_error",
			message: `Capability "${name}" failed: ${error instanceof Error ? error.message : String(error)}`
		});
		emitCapabilityAudit({
			capability: name,
			effect: resolved.capability.effect,
			transport: "server",
			via: host.via ?? null,
			outcome: "internal_error",
			status: 500,
			durationMs: performance.now() - started,
			agent: capabilityHostAgent(host, context)
		}, host.onAudit);
		return envelope;
	}
	const agent = capabilityHostAgent(host, context);
	const status = outcome.kind === "envelope" ? outcome.status : outcome.response.status;
	const auditOutcome = outcome.kind === "envelope" ? envelopeOutcome(outcome.envelope) : `middleware_${status}`;
	emitCapabilityAudit({
		capability: name,
		effect: resolved.capability.effect,
		transport: "server",
		via: host.via ?? null,
		outcome: auditOutcome,
		status,
		durationMs: performance.now() - started,
		agent
	}, host.onAudit);
	if (outcome.kind === "envelope") return outcome.envelope;
	return errorEnvelope({
		code: middlewareErrorCode(status),
		message: `Capability middleware short-circuited with status ${status}.`
	});
}
/**
* Remote MCP tools may compose private capabilities, but they must not turn
* that server-only reachability into a bypass around agent identity or the
* confirmation flow destructive effects require. These checks run before the
* callee's pipeline, matching the placement of `agentPolicy` in HTTP dispatch
* and ensuring denied calls cannot trigger middleware side effects.
*/
function mcpCompositionGuard(host, resolved) {
	if (host.via !== "mcp") return null;
	if ((resolved.capability.agentPolicy ?? host.app.agents?.webBotAuth?.policy ?? "observe") === "require" && !host.agent) {
		const envelope = errorEnvelope({
			code: "agent_required",
			message: `Capability "${resolved.name}" requires a verified agent signature (Web Bot Auth).`
		});
		return {
			kind: "envelope",
			status: 401,
			envelope,
			response: envelopeResponse(401, envelope)
		};
	}
	if (resolved.capability.effect === "destructive" && !host.destructiveConfirmed) {
		const envelope = errorEnvelope({
			code: "forbidden",
			message: `Capability "${resolved.name}" cannot be composed from remote MCP because it is destructive and no confirmed destructive dispatch is in scope for this request.`
		});
		return {
			kind: "envelope",
			status: 403,
			envelope,
			response: envelopeResponse(403, envelope)
		};
	}
	return null;
}
/**
* Keep the context seen by nested MCP middleware and capability bodies on the
* same trusted identity used by the policy guard and audit trail. The
* framework-owned field is rebound to an immutable snapshot without changing
* other shared request-context fields. Immutable contexts receive an
* extensible receiver-preserving overlay, so binding identity never turns a
* valid nested call into a rejected promise.
*/
function capabilityPipelineContext(host, supplied) {
	let context = supplied ?? {};
	if (!!host.app.agents?.webBotAuth && (host.via === "http" || host.via === "mcp")) context = bindAgentContext(context, host.agent ?? null);
	if (host.via === "mcp" && host.tokenAuth !== void 0) context = rebindMcpTokenContext(context, host.tokenAuth);
	return context;
}
function capabilityHostAgent(host, context) {
	return host.via === "http" || host.via === "mcp" ? host.agent ?? null : context.agent ?? null;
}
function errorEnvelope(error) {
	return {
		ok: false,
		error
	};
}
function envelopeResponse(status, envelope) {
	return new Response(JSON.stringify(envelope), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" }
	});
}
//#endregion
export { CAPABILITY_HTTP_PREFIX, addCapabilityAuditListener, capabilityHttpPath, clearCapabilityAuditListeners, clearDestructiveConfirmed, envelopeResponse, handleCapabilityRequest, invokeCapability, invokeCapabilityOnHost, isRegisteredCapabilityHttpPath, matchCapabilityRoute, resolveAppCapabilities, setActiveCapabilityHost, setCapabilityAuditHook };
