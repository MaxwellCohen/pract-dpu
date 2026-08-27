import { PrachtAgentIdentity, WebBotAuthConfig } from "./types.mjs";

//#region src/runtime-agent-auth.d.ts
interface VerifyAgentSignatureOptions extends WebBotAuthConfig {
  /** Injectable clock (unix seconds) and fetch for tests. */
  now?: () => number;
  fetchImpl?: typeof fetch;
}
/**
 * Verify a Web Bot Auth signature on the request. Resolves to the verified
 * agent identity, or `null` when the request is unsigned or verification
 * fails for any reason (fail closed — this function never throws).
 */
declare function verifyAgentSignature(request: Request, options: VerifyAgentSignatureOptions): Promise<PrachtAgentIdentity | null>;
//#endregion
export { VerifyAgentSignatureOptions, verifyAgentSignature };