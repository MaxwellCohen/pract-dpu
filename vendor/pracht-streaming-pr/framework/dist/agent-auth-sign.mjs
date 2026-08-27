import { ed25519JwkThumbprint } from "./runtime-agent-auth.mjs";
//#region src/agent-auth-sign.ts
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
const REQUIRED_COMPONENTS = ["@authority", "signature-agent"];
const DEFAULT_LIFETIME_SECONDS = 300;
const MAX_LIFETIME_SECONDS = 86400;
const WEB_BOT_AUTH_TAG = "web-bot-auth";
const HEADER_CRLF_RE = /[\r\n]/;
/** RFC 8941 key: lowercase alpha or `*` first, then alphanumerics and `_-.*`. */
const SIGNATURE_LABEL_RE = /^[a-z*][a-z0-9_\-.*]*$/;
const encoder = new TextEncoder();
function bytesToBase64(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
/**
* RFC 8941 quoted string. Escaping matters: an agent identity containing a
* quote would otherwise produce a `Signature-Agent` header the verifier parses
* differently than the signer signed, which fails closed but confusingly.
*/
function quoteString(value) {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}
/**
* The RFC 9421 signature base. Mirrors `buildSignatureBase()` in the verifier —
* the two must agree byte-for-byte or nothing verifies.
*/
function buildSigningBase(request, components, signatureAgent, params) {
	const url = new URL(request.url);
	const lines = [];
	for (const component of components) {
		let value;
		switch (component) {
			case "@authority":
				value = url.host.toLowerCase();
				break;
			case "@method":
				value = request.method.toUpperCase();
				break;
			case "@scheme":
				value = url.protocol.replace(/:$/, "");
				break;
			case "@target-uri":
				value = request.url;
				break;
			case "@path":
				value = url.pathname;
				break;
			case "@query":
				value = url.search === "" ? "?" : url.search;
				break;
			case "signature-agent":
				value = signatureAgent;
				break;
			default: {
				if (component.startsWith("@")) throw new Error(`[pracht] Cannot sign unsupported derived component ${JSON.stringify(component)}. Supported: "@authority", "@method", "@scheme", "@target-uri", "@path", "@query".`);
				if (component !== component.toLowerCase()) throw new Error(`[pracht] Covered header component ${JSON.stringify(component)} must be lowercase.`);
				const headerValue = request.headers.get(component);
				if (headerValue === null) throw new Error(`[pracht] Cannot sign header component ${JSON.stringify(component)}: the request does not carry it. Set the header before signing.`);
				value = headerValue.trim().replace(/[\r\n]+\s*/g, " ");
			}
		}
		lines.push(`"${component}": ${value}`);
	}
	lines.push(`"@signature-params": ${params}`);
	return lines.join("\n");
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
async function createAgentSignatureHeaders(request, options) {
	const { agent, privateKeyJwk } = options;
	if (!agent) throw new Error("[pracht] signAgentRequest requires an `agent` identity.");
	if (HEADER_CRLF_RE.test(agent)) throw new Error("[pracht] signAgentRequest `agent` must not contain CR or LF.");
	let agentUrl;
	try {
		agentUrl = new URL(agent);
	} catch {
		throw new Error(`[pracht] signAgentRequest \`agent\` must be an absolute URL, got ${JSON.stringify(agent)}.`);
	}
	if (agentUrl.protocol !== "https:" && agentUrl.hostname !== "localhost") throw new Error(`[pracht] signAgentRequest \`agent\` must be an https URL, got ${JSON.stringify(agent)}.`);
	if (privateKeyJwk?.kty !== "OKP" || privateKeyJwk.crv !== "Ed25519" || !privateKeyJwk.d) throw new Error("[pracht] signAgentRequest requires an Ed25519 (OKP) private key JWK.");
	const lifetime = options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
	if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > MAX_LIFETIME_SECONDS) throw new Error(`[pracht] signAgentRequest lifetimeSeconds must be between 1 and ${MAX_LIFETIME_SECONDS}.`);
	const created = Math.floor(options.createdAt ?? Date.now() / 1e3);
	const label = options.label ?? "sig1";
	if (!SIGNATURE_LABEL_RE.test(label)) throw new Error(`[pracht] signAgentRequest label ${JSON.stringify(label)} is not a valid RFC 8941 dictionary key.`);
	const keyId = options.keyId ?? await ed25519JwkThumbprint(privateKeyJwk.x);
	if (/["\\]/.test(keyId)) throw new Error(`[pracht] signAgentRequest keyId ${JSON.stringify(keyId)} must not contain quotes or backslashes.`);
	const signatureAgent = quoteString(agent);
	const components = [...REQUIRED_COMPONENTS, ...(options.additionalComponents ?? []).filter((component) => !REQUIRED_COMPONENTS.includes(component))];
	const params = `(${components.map((component) => quoteString(component)).join(" ")});created=${created};expires=${created + lifetime};keyid=${quoteString(keyId)};alg="ed25519"` + (options.nonce === void 0 ? "" : `;nonce=${quoteString(options.nonce)}`) + `;tag="${WEB_BOT_AUTH_TAG}"`;
	const base = buildSigningBase(request, components, signatureAgent, params);
	const key = await crypto.subtle.importKey("jwk", {
		crv: "Ed25519",
		d: privateKeyJwk.d,
		key_ops: ["sign"],
		kty: "OKP",
		x: privateKeyJwk.x
	}, { name: "Ed25519" }, false, ["sign"]);
	return {
		signature: `${label}=:${bytesToBase64(new Uint8Array(await crypto.subtle.sign("Ed25519", key, encoder.encode(base))))}:`,
		"signature-agent": signatureAgent,
		"signature-input": `${label}=${params}`
	};
}
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
async function signAgentRequest(request, options) {
	const headers = await createAgentSignatureHeaders(request, options);
	const signed = new Request(request.bodyUsed ? request : request.clone());
	for (const [name, value] of Object.entries(headers)) signed.headers.set(name, value);
	return signed;
}
/**
* Generate an Ed25519 keypair for an agent: the private JWK to sign with, the
* public JWK to publish in a key directory, and the `keyid` thumbprint both
* sides use to refer to it.
*/
async function generateAgentKeyPair() {
	const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
	const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
	if (!privateJwk.d || !privateJwk.x) throw new Error("[pracht] Ed25519 key generation did not produce a usable JWK.");
	return {
		keyId: await ed25519JwkThumbprint(privateJwk.x),
		privateKeyJwk: {
			crv: "Ed25519",
			d: privateJwk.d,
			kty: "OKP",
			x: privateJwk.x
		},
		publicKeyJwk: {
			crv: "Ed25519",
			kty: "OKP",
			x: privateJwk.x
		}
	};
}
//#endregion
export { createAgentSignatureHeaders, generateAgentKeyPair, signAgentRequest };
