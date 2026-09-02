//#region src/protocol.d.ts
/**
 * The capability wire contract — the single home for every name the
 * projections share: the HTTP path formula, the confirmation header, and the
 * envelope error codes. The framework runtime, the Vite plugin's generated
 * client modules, and the CLI (eval runner, verify, typegen) all import from
 * here, so the protocol cannot drift between packages.
 */
declare const CAPABILITY_HTTP_PREFIX = "/api/capabilities/";
/** Default HTTP path for a capability name: dots become slashes. */
declare function capabilityHttpPath(name: string): string;
/** Normalize a dispatch path for matching: strip a single trailing slash. */
declare function normalizeCapabilityHttpPath(path: string): string;
/**
 * Whether a custom capability endpoint is an exact same-origin pathname.
 *
 * Parsing against a fixed origin catches protocol-relative paths, backslashes,
 * ASCII control characters, dot-segment normalization, queries, and fragments.
 * Requiring the parsed pathname to equal the source keeps generated browser
 * fetches on the application origin.
 */
declare function isValidCapabilityHttpPath(path: unknown): path is string;
/** Default path the remote MCP projection is served from. */
declare const DEFAULT_MCP_ENDPOINT = "/mcp";
/** Newest first; `initialize` negotiates down to a version both sides know. */
declare const MCP_PROTOCOL_VERSIONS: readonly ["2025-11-25", "2025-06-18"];
declare const MCP_LATEST_PROTOCOL_VERSION: "2025-11-25";
/** Header carrying the negotiated protocol version on every request after `initialize`. */
declare const MCP_PROTOCOL_VERSION_HEADER = "mcp-protocol-version";
/**
 * `_meta` key carrying a prepare/commit confirmation token on a `tools/call`.
 *
 * MCP has no per-call header channel, and the token cannot travel in
 * `arguments`: it is bound to a hash of the canonicalized input, so adding it
 * there would invalidate the very binding it carries. `_meta` is the
 * protocol's designated extension slot.
 */
declare const MCP_CONFIRMATION_META_KEY = "io.pracht/confirmation";
/** `_meta` key naming the capability behind a projected tool or tool result. */
declare const MCP_CAPABILITY_META_KEY = "io.pracht/capability";
/** `_meta` key carrying a projected tool's effect class. */
declare const MCP_EFFECT_META_KEY = "io.pracht/effect";
/** `_meta` key carrying the capability dispatch status on an `isError` tool result. */
declare const MCP_STATUS_META_KEY = "io.pracht/status";
/**
 * `_meta` key carrying the capability envelope's error payload (`code`,
 * `message`, and any validation `issues`) on an `isError` tool result. MCP tool
 * errors are prose by design; this is how a machine caller — `pracht eval`, a
 * typed client — reads the same error code the HTTP projection returns.
 */
declare const MCP_ERROR_META_KEY = "io.pracht/error";
declare const MCP_TOOL_NAME_ERROR = "projected MCP tool names must match ^[a-zA-Z0-9_-]{1,64}$ after dots become underscores";
/**
 * MCP tool name for a capability.
 *
 * Capability names are dot-separated (`notes.search`), but MCP hosts widely
 * constrain tool names to `^[a-zA-Z0-9_-]{1,64}$` — the function-name rule
 * most clients inherit. Dots become underscores, which is unambiguous only as
 * long as no two capabilities collide; see {@link findMcpToolNameCollisions}.
 */
declare function mcpToolName(capabilityName: string): string;
/** Whether a projected tool name is accepted by the MCP hosts Pracht targets. */
declare function isValidMcpToolName(toolName: unknown): toolName is string;
declare const WEBMCP_TOOL_NAME_ERROR: string;
declare function isValidWebmcpToolName(toolName: unknown): toolName is string;
interface McpToolNameCollision {
  toolName: string;
  capabilities: string[];
}
/**
 * Capability names that would produce the same MCP tool name (e.g.
 * `notes.search` and `notes_search`). `pracht verify` rejects these, and the
 * runtime refuses to serve an ambiguous graph.
 */
declare function findMcpToolNameCollisions(names: readonly string[]): McpToolNameCollision[];
/**
 * Header that carries the prepare/commit confirmation token when committing a
 * destructive capability call (see docs/AGENT_TRUST.md).
 */
declare const CONFIRMATION_HEADER = "x-pracht-confirm";
/** Environment variable holding the confirmation-token HMAC secret. */
declare const CONFIRMATION_SECRET_ENV = "PRACHT_CONFIRMATION_SECRET";
/**
 * Every error code a capability envelope can carry. The first group is
 * produced by the server dispatch pipeline; `network_error` and
 * `invalid_response` are produced client-side by the generated
 * `callCapability()` helper when the endpoint cannot be reached or answers
 * with something other than the envelope.
 */
declare const CAPABILITY_ERROR_CODES: readonly ["invalid_input", "invalid_output", "invalid_json", "internal_error", "method_not_allowed", "agent_required", "confirmation_required", "confirmation_pending", "confirmation_unavailable", "confirmation_invalid", "unknown_capability", "unauthorized", "forbidden", "rate_limited", "middleware_rejected", "redirect", "cross_origin_blocked", "network_error", "invalid_response"];
type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number];
/**
 * Optional transport marker the generated WebMCP shim sends with its
 * dispatches so audit events can distinguish in-browser agent traffic
 * (cookie-authenticated) from remote HTTP callers. Informational only — like
 * any client-sent header it is not a trust signal.
 */
declare const CAPABILITY_TRANSPORT_HEADER = "x-pracht-transport";
/**
 * Response header carrying the matched capability's effect class. Enhanced
 * `<Form capability>` submissions read it so successful `read` operations do
 * not invalidate route data while mutations still do.
 */
declare const CAPABILITY_EFFECT_HEADER = "x-pracht-capability-effect";
/**
 * Marker sent by enhanced `<Form>` submissions. Pracht API and capability
 * dispatch turn redirect responses into a readable redirect header so the
 * browser can navigate without fetching the destination first or following an
 * external target as a CORS fetch. The historical name remains part of the
 * public protocol for compatibility.
 */
declare const CAPABILITY_FORM_REQUEST_HEADER = "x-pracht-capability-form";
/** Redirect target returned for an enhanced Pracht form submission. */
declare const CAPABILITY_FORM_REDIRECT_HEADER = "x-pracht-capability-redirect";
/**
 * Window event dispatched after a browser-side capability call settles —
 * by the generated `callCapability()` helper and by `<Form capability>`.
 * The framework's route runtime listens and revalidates the active route's
 * data after successful non-`read` calls, so mutations made through the
 * agent surface and the human UI keep the page consistent the same way.
 * `detail`: `{ name, effect, ok, revalidate }` (`effect`/`revalidate` may be
 * absent when an older or non-Pracht dispatcher doesn't know them).
 */
declare const CAPABILITY_SETTLED_EVENT = "pracht:capability-settled";
/**
 * Verified agent identity, surfaced as `context.agent` when the app
 * configures Web Bot Auth (`defineApp({ agents: { webBotAuth } })`).
 */
interface PrachtAgentIdentity {
  readonly verified: true;
  /** Host of the agent's Signature-Agent directory URL (or the static key's `agent` label). */
  readonly agentDomain: string | null;
  /** The `keyid` signature parameter (base64url JWK thumbprint). */
  readonly keyId: string;
}
//#endregion
//#region src/schema.d.ts
/**
 * Dependency-free JSON Schema subset validator.
 *
 * Capabilities store plain JSON Schema so the graph stays serializable and
 * the same schema can be projected to agent surfaces (WebMCP, MCP) without a
 * runtime schema library in application bundles. Only a deliberate subset is
 * supported; schemas using anything else are rejected at definition time so
 * a keyword the validator would silently ignore can never widen what an
 * exposed capability accepts.
 *
 * Supported keywords:
 *   type (object/array/string/number/integer/boolean/null), properties,
 *   required, additionalProperties, items, enum, const, minimum, maximum,
 *   minLength, maxLength, default (applied to input), plus the pure
 *   annotations title and description.
 */
type JsonSchema = Record<string, unknown>;
interface CapabilityIssue {
  /** JSON-pointer-ish path into the validated value, e.g. "/limit". Empty for the root. */
  path: string;
  message: string;
}
/**
 * Walk a schema and collect every keyword outside the supported subset,
 * prefixed with its schema path (e.g. `/properties/query/pattern`). Used by
 * `defineCapability()` to fail fast and by `pracht verify` messaging.
 */
declare function collectUnsupportedSchemaKeywords(schema: unknown, path?: string): string[];
/** Collect malformed values for keywords in the supported schema subset. */
declare function collectInvalidSchemaKeywordValues(schema: unknown, path?: string): string[];
/**
 * Return a copy of `value` with schema `default`s filled in for missing
 * object properties, recursively. The input value is never mutated.
 */
declare function applySchemaDefaults(schema: unknown, value: unknown): unknown;
/**
 * Validate `value` against the schema subset. Returns an empty array when the
 * value conforms. Every issue carries a path scoped to the offending value so
 * callers (and agents) can pinpoint what to fix.
 */
declare function validateAgainstSchema(schema: unknown, value: unknown, path?: string): CapabilityIssue[];
//#endregion
//#region src/capability.d.ts
/**
 * Side-effect classification. Every capability must declare one; the
 * framework's exposure policy is driven by it. `destructive` capabilities may
 * be exposed over HTTP and over remote MCP, where every dispatch is gated by
 * the server-verified prepare/commit confirmation flow (see
 * docs/AGENT_TRUST.md) — MCP additionally requires the `agents.mcp.destructive`
 * opt-in. WebMCP page tools stay disallowed for them: a browser host's
 * approval UX is not a security boundary.
 */
type CapabilityEffect = "read" | "write" | "destructive";
/**
 * Web Bot Auth policy for the capability's HTTP endpoint:
 * - `"observe"` — serve everyone, surface the verified identity on context;
 * - `"require"` — reject unsigned/unverified requests with a 401 envelope.
 * Unset inherits the app-wide default from `defineApp({ agents })`.
 */
type CapabilityAgentPolicy = "observe" | "require";
interface CapabilityHttpExposure {
  method: "POST";
  /** Custom dispatch path. Defaults to `/api/capabilities/<name-with-dots-as-slashes>`. */
  path?: string;
}
interface CapabilityExposeConfig {
  /** Serve the capability over HTTP. `true` uses `POST` at the default path. */
  http?: true | {
    method?: "POST";
    path?: string;
  };
  /**
   * Advertise the capability to the configured remote MCP projection. A
   * `destructive` capability is only served when the app also sets
   * `agents.mcp.destructive`; otherwise the projection filters it out.
   */
  mcp?: boolean;
  /**
   * Register the capability as a WebMCP page tool. Requires `http` — calls
   * dispatch through the HTTP projection. The object form sets
   * `untrustedContent: true` to advertise the spec's `untrustedContentHint`
   * annotation for tools whose results carry user-generated or third-party
   * content the host should treat as untrusted.
   */
  webmcp?: boolean | CapabilityWebmcpOptions;
}
interface CapabilityWebmcpOptions {
  /** Advertise `untrustedContentHint` — results may carry user-generated or third-party content. */
  untrustedContent?: boolean;
}
/** Normalized exposure — what the framework and graph consume. */
interface CapabilityExposure {
  http: CapabilityHttpExposure | null;
  mcp: boolean;
  webmcp: boolean;
  /** The WebMCP tool's `untrustedContentHint` annotation. Always `false` when `webmcp` is `false`. */
  webmcpUntrustedContent: boolean;
}
/**
 * The request context a capability handler receives by default: the verified
 * agent identity the framework surfaces on every request, plus whatever app
 * middleware attached. Narrow the open part with your own context type via
 * the third `defineCapability` generic.
 */
interface CapabilityContext {
  /** Verified agent identity (Web Bot Auth); `null` when unsigned/unverified, absent when the app does not configure agents. */
  readonly agent?: PrachtAgentIdentity | null;
  [key: string]: unknown;
}
interface CapabilityRunArgs<TInput = unknown, TContext = CapabilityContext> {
  input: TInput;
  context: TContext;
  request: Request;
  signal: AbortSignal;
}
interface CapabilityDefinition<TInput = unknown, TOutput = unknown, TContext = CapabilityContext> {
  title: string;
  description: string;
  /** JSON Schema (supported subset) for the capability input. */
  input: JsonSchema;
  /** JSON Schema (supported subset) for the capability output. */
  output: JsonSchema;
  effect: CapabilityEffect;
  /** Named middleware from the app manifest, run before the handler. */
  middleware?: string[];
  /** Explicit exposure. A capability without `expose` is only callable server-side. */
  expose?: CapabilityExposeConfig;
  /** Per-capability Web Bot Auth policy override for the HTTP endpoint. */
  agentPolicy?: CapabilityAgentPolicy;
  run: (args: CapabilityRunArgs<TInput, TContext>) => TOutput | Promise<TOutput>;
}
type CapabilityValidationResult<T = unknown> = {
  ok: true;
  value: T;
} | {
  ok: false;
  issues: CapabilityIssue[];
};
/**
 * The object `defineCapability()` returns. The validation methods are
 * attached here so the framework runtime can execute capabilities through a
 * structural contract without depending on this package.
 */
interface Capability<TInput = unknown, TOutput = unknown, TContext = CapabilityContext> {
  kind: "capability";
  title: string;
  description: string;
  input: JsonSchema;
  output: JsonSchema;
  effect: CapabilityEffect;
  middleware: string[];
  expose: CapabilityExposure | null;
  agentPolicy?: CapabilityAgentPolicy;
  run: (args: CapabilityRunArgs<TInput, TContext>) => TOutput | Promise<TOutput>;
  /** Apply input defaults and validate. Returns the defaulted value on success. */
  validateInput: (value: unknown) => CapabilityValidationResult<TInput>;
  validateOutput: (value: unknown) => CapabilityValidationResult<TOutput>;
}
/** Result/error envelope shared by HTTP, WebMCP, and direct server invocation. */
type CapabilityEnvelope<T = unknown> = {
  ok: true;
  data: T;
} | {
  ok: false;
  error: CapabilityErrorPayload;
};
interface CapabilityErrorPayload {
  code: CapabilityErrorCode;
  message: string;
  issues?: CapabilityIssue[];
  /** Present on `confirmation_required` errors: pass it back via the CONFIRMATION_HEADER. */
  confirmationToken?: string;
  /** Unix seconds when `confirmationToken` expires. */
  expiresAt?: number;
  /**
   * Present on `confirmation_required`/`confirmation_pending` when an approval
   * store is registered: the proposal's id, for correlating with a review
   * surface. Derived server-side from the principal, capability, and input —
   * never accepted from a caller.
   */
  approvalId?: string;
  /**
   * Present when a decided proposal is blocking a re-prepare of the identical
   * operation: seconds until it expires and the operation can be proposed
   * again. The refusal is deliberate — it stops an old still-valid token
   * becoming reusable — so this says when to come back rather than inviting an
   * immediate retry.
   */
  retryAfterSeconds?: number;
}
declare const DESTRUCTIVE_EXPOSURE_ERROR: string;
declare const MCP_SCHEMA_ROOT_ERROR = "expose.mcp requires \"input\" and \"output\" schemas with type: \"object\" for the supported MCP protocol versions";
/**
 * Define a protocol-neutral application capability.
 *
 * Fails fast (throws) on invalid definitions instead of deferring problems to
 * request time: missing contract fields, schemas outside the supported JSON
 * Schema subset, `webmcp` exposure without an HTTP projection to dispatch
 * through, and `webmcp` exposure of a `destructive` capability.
 *
 * `destructive` + `expose.http` and `destructive` + `expose.mcp` are both
 * allowed — the runtime's server-verified prepare/commit confirmation flow
 * gates every dispatch on either transport. Serving destructive tools over
 * remote MCP additionally requires the app-level `agents.mcp.destructive`
 * opt-in and a registered approval store; without the opt-in the projection
 * filters them out at serve time.
 */
declare function defineCapability<TInput = unknown, TOutput = unknown, TContext = CapabilityContext>(definition: CapabilityDefinition<TInput, TOutput, TContext>): Capability<TInput, TOutput, TContext>;
//#endregion
//#region src/form.d.ts
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
declare function coerceFormInput(schema: unknown, entries: Iterable<[string, unknown]>): Record<string, unknown>;
//#endregion
//#region src/schema-type-text.d.ts
/**
 * JSON Schema (supported subset) → TypeScript type text, used by
 * `pracht typegen` to emit capability input/output types. It lives next to
 * the schema subset definition (see schema.ts) so the two evolve in lockstep:
 * a keyword added to the subset must be handled here or it degrades to
 * `unknown` instead of guessing.
 *
 * Position matters for optionality:
 * - `"input"` — a property is optional for the caller when it is not
 *   `required` or when it declares a `default` (defaults are applied before
 *   validation, so the caller may always omit it);
 * - `"output"` — a property is optional exactly when it is not `required`.
 */
type SchemaTypePosition = "input" | "output";
declare function schemaToTypeText(schema: unknown, position: SchemaTypePosition): string;
//#endregion
export { CAPABILITY_EFFECT_HEADER, CAPABILITY_ERROR_CODES, CAPABILITY_FORM_REDIRECT_HEADER, CAPABILITY_FORM_REQUEST_HEADER, CAPABILITY_HTTP_PREFIX, CAPABILITY_SETTLED_EVENT, CAPABILITY_TRANSPORT_HEADER, CONFIRMATION_HEADER, CONFIRMATION_SECRET_ENV, type Capability, type CapabilityAgentPolicy, type CapabilityContext, type CapabilityDefinition, type CapabilityEffect, type CapabilityEnvelope, type CapabilityErrorCode, type CapabilityErrorPayload, type CapabilityExposeConfig, type CapabilityExposure, type CapabilityHttpExposure, type CapabilityIssue, type CapabilityRunArgs, type CapabilityValidationResult, type CapabilityWebmcpOptions, DEFAULT_MCP_ENDPOINT, DESTRUCTIVE_EXPOSURE_ERROR, type JsonSchema, MCP_CAPABILITY_META_KEY, MCP_CONFIRMATION_META_KEY, MCP_EFFECT_META_KEY, MCP_ERROR_META_KEY, MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSION_HEADER, MCP_SCHEMA_ROOT_ERROR, MCP_STATUS_META_KEY, MCP_TOOL_NAME_ERROR, type McpToolNameCollision, type PrachtAgentIdentity, type SchemaTypePosition, WEBMCP_TOOL_NAME_ERROR, applySchemaDefaults, capabilityHttpPath, coerceFormInput, collectInvalidSchemaKeywordValues, collectUnsupportedSchemaKeywords, defineCapability, findMcpToolNameCollisions, isValidCapabilityHttpPath, isValidMcpToolName, isValidWebmcpToolName, mcpToolName, normalizeCapabilityHttpPath, schemaToTypeText, validateAgainstSchema };