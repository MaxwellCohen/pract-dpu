//#region src/protocol.ts
/**
* The capability wire contract — the single home for every name the
* projections share: the HTTP path formula, the confirmation header, and the
* envelope error codes. The framework runtime, the Vite plugin's generated
* client modules, and the CLI (eval runner, verify, typegen) all import from
* here, so the protocol cannot drift between packages.
*/
const CAPABILITY_HTTP_PREFIX = "/api/capabilities/";
/** Default HTTP path for a capability name: dots become slashes. */
function capabilityHttpPath(name) {
	return `${CAPABILITY_HTTP_PREFIX}${name.split(".").join("/")}`;
}
/** Normalize a dispatch path for matching: strip a single trailing slash. */
function normalizeCapabilityHttpPath(path) {
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
/**
* Whether a custom capability endpoint is an exact same-origin pathname.
*
* Parsing against a fixed origin catches protocol-relative paths, backslashes,
* ASCII control characters, dot-segment normalization, queries, and fragments.
* Requiring the parsed pathname to equal the source keeps generated browser
* fetches on the application origin.
*/
function isValidCapabilityHttpPath(path) {
	if (typeof path !== "string" || !path.startsWith("/")) return false;
	try {
		const parsed = new URL(path, "https://pracht.invalid");
		return parsed.origin === "https://pracht.invalid" && parsed.pathname === path && parsed.search === "" && parsed.hash === "";
	} catch {
		return false;
	}
}
/** Default path the remote MCP projection is served from. */
const DEFAULT_MCP_ENDPOINT = "/mcp";
/** Newest first; `initialize` negotiates down to a version both sides know. */
const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"];
const MCP_LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];
/** Header carrying the negotiated protocol version on every request after `initialize`. */
const MCP_PROTOCOL_VERSION_HEADER = "mcp-protocol-version";
/**
* `_meta` key carrying a prepare/commit confirmation token on a `tools/call`.
*
* MCP has no per-call header channel, and the token cannot travel in
* `arguments`: it is bound to a hash of the canonicalized input, so adding it
* there would invalidate the very binding it carries. `_meta` is the
* protocol's designated extension slot.
*/
const MCP_CONFIRMATION_META_KEY = "io.pracht/confirmation";
/** `_meta` key naming the capability behind a projected tool or tool result. */
const MCP_CAPABILITY_META_KEY = "io.pracht/capability";
/** `_meta` key carrying a projected tool's effect class. */
const MCP_EFFECT_META_KEY = "io.pracht/effect";
/** `_meta` key carrying the capability dispatch status on an `isError` tool result. */
const MCP_STATUS_META_KEY = "io.pracht/status";
/**
* `_meta` key carrying the capability envelope's error payload (`code`,
* `message`, and any validation `issues`) on an `isError` tool result. MCP tool
* errors are prose by design; this is how a machine caller — `pracht eval`, a
* typed client — reads the same error code the HTTP projection returns.
*/
const MCP_ERROR_META_KEY = "io.pracht/error";
const MCP_TOOL_NAME_ERROR = "projected MCP tool names must match ^[a-zA-Z0-9_-]{1,64}$ after dots become underscores";
const MCP_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
/**
* MCP tool name for a capability.
*
* Capability names are dot-separated (`notes.search`), but MCP hosts widely
* constrain tool names to `^[a-zA-Z0-9_-]{1,64}$` — the function-name rule
* most clients inherit. Dots become underscores, which is unambiguous only as
* long as no two capabilities collide; see {@link findMcpToolNameCollisions}.
*/
function mcpToolName(capabilityName) {
	return capabilityName.split(".").join("_");
}
/** Whether a projected tool name is accepted by the MCP hosts Pracht targets. */
function isValidMcpToolName(toolName) {
	return typeof toolName === "string" && MCP_TOOL_NAME_RE.test(toolName);
}
/**
* Capability names that would produce the same MCP tool name (e.g.
* `notes.search` and `notes_search`). `pracht verify` rejects these, and the
* runtime refuses to serve an ambiguous graph.
*/
function findMcpToolNameCollisions(names) {
	const byToolName = /* @__PURE__ */ new Map();
	for (const name of names) {
		const toolName = mcpToolName(name);
		const bucket = byToolName.get(toolName);
		if (bucket) bucket.push(name);
		else byToolName.set(toolName, [name]);
	}
	return [...byToolName].filter(([, capabilities]) => capabilities.length > 1).map(([toolName, capabilities]) => ({
		toolName,
		capabilities
	}));
}
/**
* Header that carries the prepare/commit confirmation token when committing a
* destructive capability call (see docs/AGENT_TRUST.md).
*/
const CONFIRMATION_HEADER = "x-pracht-confirm";
/** Environment variable holding the confirmation-token HMAC secret. */
const CONFIRMATION_SECRET_ENV = "PRACHT_CONFIRMATION_SECRET";
/**
* Every error code a capability envelope can carry. The first group is
* produced by the server dispatch pipeline; `network_error` and
* `invalid_response` are produced client-side by the generated
* `callCapability()` helper when the endpoint cannot be reached or answers
* with something other than the envelope.
*/
const CAPABILITY_ERROR_CODES = [
	"invalid_input",
	"invalid_output",
	"invalid_json",
	"internal_error",
	"method_not_allowed",
	"agent_required",
	"confirmation_required",
	"confirmation_pending",
	"confirmation_unavailable",
	"confirmation_invalid",
	"unknown_capability",
	"unauthorized",
	"forbidden",
	"rate_limited",
	"middleware_rejected",
	"redirect",
	"cross_origin_blocked",
	"network_error",
	"invalid_response"
];
/**
* Optional transport marker the generated WebMCP shim sends with its
* dispatches so audit events can distinguish in-browser agent traffic
* (cookie-authenticated) from remote HTTP callers. Informational only — like
* any client-sent header it is not a trust signal.
*/
const CAPABILITY_TRANSPORT_HEADER = "x-pracht-transport";
/**
* Response header carrying the matched capability's effect class. Enhanced
* `<Form capability>` submissions read it so successful `read` operations do
* not invalidate route data while mutations still do.
*/
const CAPABILITY_EFFECT_HEADER = "x-pracht-capability-effect";
/**
* Marker sent by enhanced `<Form>` submissions. Pracht API and capability
* dispatch turn redirect responses into a readable redirect header so the
* browser can navigate without fetching the destination first or following an
* external target as a CORS fetch. The historical name remains part of the
* public protocol for compatibility.
*/
const CAPABILITY_FORM_REQUEST_HEADER = "x-pracht-capability-form";
/** Redirect target returned for an enhanced Pracht form submission. */
const CAPABILITY_FORM_REDIRECT_HEADER = "x-pracht-capability-redirect";
/**
* Window event dispatched after a browser-side capability call settles —
* by the generated `callCapability()` helper and by `<Form capability>`.
* The framework's route runtime listens and revalidates the active route's
* data after successful non-`read` calls, so mutations made through the
* agent surface and the human UI keep the page consistent the same way.
* `detail`: `{ name, effect, ok, revalidate }` (`effect`/`revalidate` may be
* absent when an older or non-Pracht dispatcher doesn't know them).
*/
const CAPABILITY_SETTLED_EVENT = "pracht:capability-settled";
//#endregion
export { isValidMcpToolName as C, isValidCapabilityHttpPath as S, normalizeCapabilityHttpPath as T, MCP_PROTOCOL_VERSION_HEADER as _, CAPABILITY_HTTP_PREFIX as a, capabilityHttpPath as b, CONFIRMATION_HEADER as c, MCP_CAPABILITY_META_KEY as d, MCP_CONFIRMATION_META_KEY as f, MCP_PROTOCOL_VERSIONS as g, MCP_LATEST_PROTOCOL_VERSION as h, CAPABILITY_FORM_REQUEST_HEADER as i, CONFIRMATION_SECRET_ENV as l, MCP_ERROR_META_KEY as m, CAPABILITY_ERROR_CODES as n, CAPABILITY_SETTLED_EVENT as o, MCP_EFFECT_META_KEY as p, CAPABILITY_FORM_REDIRECT_HEADER as r, CAPABILITY_TRANSPORT_HEADER as s, CAPABILITY_EFFECT_HEADER as t, DEFAULT_MCP_ENDPOINT as u, MCP_STATUS_META_KEY as v, mcpToolName as w, findMcpToolNameCollisions as x, MCP_TOOL_NAME_ERROR as y };
