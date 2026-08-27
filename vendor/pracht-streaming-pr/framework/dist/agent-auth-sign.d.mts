//#region src/agent-auth-sign.d.ts
/**
 * Web Bot Auth: the *signing* side of RFC 9421 HTTP Message Signatures.
 *
 * `runtime-agent-auth.ts` verifies inbound agent requests. This module is its
 * counterpart for outbound ones — what an agent, an eval scenario, or a test
 * needs to actually reach a capability that declares `agentPolicy: "require"`.
 *
 * It lives behind its own entry point (`@pracht/core/agent-auth`) rather than
 * on `@pracht/core/server` because nothing in a deployed app signs requests;
 * bundling a private-key code path into every worker would be pure weight.
 *
 * Web-platform only (`crypto.subtle`, `Headers`), so it runs anywhere the
 * verifier does: Node ≥ 20, Workers, and Vercel Edge.
 *
 * ```ts
 * import { signAgentRequest } from "@pracht/core/agent-auth";
 *
 * const response = await fetch(
 *   await signAgentRequest(new Request(url, { method: "POST", body }), {
 *     agent: "https://my-agent.example",
 *     privateKeyJwk: { crv: "Ed25519", d: "...", kty: "OKP", x: "..." },
 *   }),
 * );
 * ```
 */
/** Ed25519 private key in JWK form — the `d` (private) and `x` (public) pair. */
interface AgentSigningJwk {
  kty: "OKP";
  crv: "Ed25519";
  /** Base64url private scalar. */
  d: string;
  /** Base64url public key. */
  x: string;
}
interface AgentSignatureOptions {
  /**
   * The agent's `Signature-Agent` identity — the HTTPS origin serving its key
   * directory, e.g. `https://my-agent.example`. Sent as a quoted string and
   * covered by the signature.
   */
  agent: string;
  /** The agent's Ed25519 private key. */
  privateKeyJwk: AgentSigningJwk;
  /**
   * `keyid`. Defaults to the RFC 8037 JWK thumbprint of `privateKeyJwk.x`,
   * which is what the verifier and the key directory both expect — override
   * only to reproduce a non-conforming peer.
   */
  keyId?: string;
  /** Signature validity window in seconds. Default 300; the draft caps it at 24 h. */
  lifetimeSeconds?: number;
  /** `created` as a Unix timestamp in seconds. Defaults to now. */
  createdAt?: number;
  /** Signature label. Default `sig1`. */
  label?: string;
  /**
   * Extra covered components beyond `@authority` and `signature-agent`, e.g.
   * `["@method", "@path"]`. Header names must be lowercase.
   */
  additionalComponents?: readonly string[];
  /** Optional `nonce` parameter. Pracht's verifier does not enforce uniqueness. */
  nonce?: string;
}
/** The three headers a signed Web Bot Auth request carries. */
interface AgentSignatureHeaders {
  "signature-agent": string;
  "signature-input": string;
  signature: string;
}
/**
 * Build the `Signature-Agent`, `Signature-Input`, and `Signature` headers for
 * `request`, without modifying it.
 *
 * The signature covers `@authority`, so it is bound to the host the request is
 * actually delivered to. Signing `localhost:3000` and having the server observe
 * `app.example.com` (a Cloudflare custom-domain route in `wrangler dev`, say)
 * will not verify — sign the authority the server sees.
 */
declare function createAgentSignatureHeaders(request: Request, options: AgentSignatureOptions): Promise<AgentSignatureHeaders>;
/**
 * Return a copy of `request` carrying Web Bot Auth signature headers.
 *
 * The original stays usable, including its body. That costs a `clone()`:
 * `new Request(otherRequest)` *disturbs* the source per the Fetch standard, so
 * the obvious one-liner would leave the caller holding a request whose body
 * throws on read — surprising for anyone who signs and then also logs the
 * payload. `clone()` throws if the body was already consumed, which is the
 * right failure: there is nothing left to sign and send.
 */
declare function signAgentRequest(request: Request, options: AgentSignatureOptions): Promise<Request>;
/**
 * Generate an Ed25519 keypair for an agent: the private JWK to sign with, the
 * public JWK to publish in a key directory, and the `keyid` thumbprint both
 * sides use to refer to it.
 */
declare function generateAgentKeyPair(): Promise<{
  keyId: string;
  privateKeyJwk: AgentSigningJwk;
  publicKeyJwk: {
    kty: "OKP";
    crv: "Ed25519";
    x: string;
  };
}>;
//#endregion
export { AgentSignatureHeaders, AgentSignatureOptions, AgentSigningJwk, createAgentSignatureHeaders, generateAgentKeyPair, signAgentRequest };