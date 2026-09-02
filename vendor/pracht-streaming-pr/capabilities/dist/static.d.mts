//#region src/static.d.ts
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
 * The parts of a capability contract that decide what gets projected to the
 * browser: whether it has an HTTP endpoint, its effect class, whether it
 * registers a WebMCP page tool, and the input schema that tool advertises.
 */
interface CapabilityProjection {
  /** Empty when `title` is not an inline string literal — the WebMCP descriptor omits it then. */
  title: string;
  description: string;
  effect: string | null;
  httpPath: string | null;
  webmcp: boolean;
  /** The WebMCP tool's `untrustedContentHint` annotation. Always `false` when `webmcp` is `false`. */
  webmcpUntrustedContent: boolean;
  inputSchema: Record<string, unknown> | null;
  /**
   * Remote MCP exposure. Not part of the browser projection — the client
   * bundle never sees it — but the app graph falls back to this extractor
   * when a capability module cannot be executed, and omitting it there would
   * report an MCP-exposed capability as unexposed.
   */
  mcp: boolean;
  /**
   * Per-capability Web Bot Auth policy, or `null` when it inherits the app
   * default. `undefined` means "declared, but not as a literal we can read" —
   * a caller must not report that as "no policy".
   */
  agentPolicy: string | null | undefined;
  /**
   * Named middleware, or `undefined` when declared as something other than an
   * inline array of string literals. Distinguishing the two matters: reporting
   * an unreadable chain as `[]` says the capability is ungated.
   */
  middleware: string[] | undefined;
}
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
declare function extractCapabilityProjection(name: string, source: string, describe: (detail: string) => string): CapabilityProjection;
/**
 * Extract the argument object text of the *default-exported*
 * `defineCapability({ ... })` call. The runtime resolves a capability module
 * by its default export, so analysis must agree: a helper `defineCapability()`
 * call earlier in the file must not be mistaken for the exported one. Matches
 * the call site (optionally with a type argument), not the import binding.
 */
declare function extractDefineCapabilityArgs(source: string): string | null;
/**
 * Scan an object literal body for its top-level properties, returning a map
 * of property name → raw value text. Depth-aware and quote/comment-aware so
 * nested schema annotations (e.g. a `description` inside `input`) are never
 * mistaken for capability fields.
 */
interface TopLevelPropertyScan {
  properties: Map<string, string>;
  /**
   * True when the scan hit a token it could not parse as a key (a spread, a
   * computed key) and stopped. Everything from that point on is missing from
   * `properties`, so a caller must not read an absent key as "not declared" —
   * that is how a spread-in `agentPolicy` or `middleware` came back as "no
   * policy, no middleware" instead of "unreadable".
   */
  truncated: boolean;
}
declare function scanTopLevelProperties(objectBody: string): Map<string, string>;
declare function scanTopLevelPropertyEntries(objectBody: string): TopLevelPropertyScan;
/** Parse the `capabilities: { ... }` block of an app manifest source. */
declare function extractCapabilityRegistrations(manifestSource: string): {
  name: string;
  file: string;
}[];
/** Extract the inline object body passed to the exported app's `defineApp()`. */
declare function extractDefineAppObjectBody(source: string): string | null;
/**
 * Find the raw text of a top-level-ish `key: { ... }` property anywhere in a
 * source file (used for the manifest's `capabilities` block).
 */
declare function findTopLevelObjectProperty(source: string, key: string): string | null;
/** Parse an extracted data literal without evaluating application code. */
declare function evaluateLiteral(expression: string): unknown;
declare function maskCommentsAndStrings(source: string): string;
//#endregion
export { CapabilityProjection, TopLevelPropertyScan, evaluateLiteral, extractCapabilityProjection, extractCapabilityRegistrations, extractDefineAppObjectBody, extractDefineCapabilityArgs, findTopLevelObjectProperty, maskCommentsAndStrings, scanTopLevelProperties, scanTopLevelPropertyEntries };