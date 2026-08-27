//#region src/runtime-agent-auth.ts
const SIGNATURE_AGENT_DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
/** The draft requires this tag; signatures with other tags are ignored. */
const WEB_BOT_AUTH_TAG = "web-bot-auth";
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
/** Draft recommends signature expiry "no more than 24 hours" after creation. */
const DEFAULT_MAX_LIFETIME_SECONDS = 86400;
const DEFAULT_DIRECTORY_CACHE_TTL_SECONDS = 300;
/** Cap on directory response bodies — a JWKS is tiny; anything bigger is hostile. */
const DIRECTORY_MAX_BYTES = 65536;
const DIRECTORY_FETCH_TIMEOUT_MS = 5e3;
/** Split a dictionary header on top-level commas (quotes and inner lists respected). */
function splitDictionaryMembers(value) {
	const members = [];
	let depth = 0;
	let inString = false;
	let start = 0;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (inString) {
			if (char === "\\") index += 1;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") inString = true;
		else if (char === "(") depth += 1;
		else if (char === ")") depth -= 1;
		else if (char === "," && depth === 0) {
			members.push(value.slice(start, index));
			start = index + 1;
		}
	}
	members.push(value.slice(start));
	return members.map((member) => member.trim()).filter((member) => member !== "");
}
/** Parse `;key=value;...` parameters. Returns null on malformed input. */
function parseParameters(raw) {
	const params = {};
	let rest = raw;
	while (rest !== "") {
		if (!rest.startsWith(";")) return null;
		rest = rest.slice(1).trimStart();
		const match = /^([a-z*][a-z0-9_.*-]*)=/.exec(rest);
		if (!match) return null;
		const key = match[1];
		rest = rest.slice(match[0].length);
		if (rest.startsWith("\"")) {
			const end = findStringEnd(rest);
			if (end === -1) return null;
			params[key] = unescapeSfString(rest.slice(1, end));
			rest = rest.slice(end + 1);
		} else {
			const valueMatch = /^-?\d+/.exec(rest);
			if (!valueMatch) return null;
			params[key] = Number(valueMatch[0]);
			rest = rest.slice(valueMatch[0].length);
		}
		rest = rest.trimStart();
	}
	return params;
}
function findStringEnd(value) {
	for (let index = 1; index < value.length; index += 1) {
		if (value[index] === "\\") {
			index += 1;
			continue;
		}
		if (value[index] === "\"") return index;
	}
	return -1;
}
function unescapeSfString(value) {
	return value.replace(/\\(.)/g, "$1");
}
/**
* Parse a `Signature-Input` dictionary: `label=("comp" ...);param=...`.
* Returns null when any member is malformed (fail closed — a partially
* parsed header must not be verified against).
*/
function parseSignatureInput(header) {
	const members = [];
	for (const memberText of splitDictionaryMembers(header)) {
		const eq = memberText.indexOf("=");
		if (eq === -1) return null;
		const label = memberText.slice(0, eq).trim();
		const raw = memberText.slice(eq + 1).trim();
		if (!raw.startsWith("(")) return null;
		const close = raw.indexOf(")");
		if (close === -1) return null;
		const componentsText = raw.slice(1, close).trim();
		const components = [];
		if (componentsText !== "") for (const item of componentsText.split(/\s+/)) {
			if (!item.startsWith("\"") || !item.endsWith("\"") || item.length < 2) return null;
			components.push(unescapeSfString(item.slice(1, -1)));
		}
		const params = parseParameters(raw.slice(close + 1).trim());
		if (!params) return null;
		members.push({
			label,
			components,
			params,
			raw
		});
	}
	return members;
}
/** Parse a `Signature` dictionary of byte sequences: `label=:base64:`. */
function parseSignatureHeader(header) {
	const signatures = {};
	for (const memberText of splitDictionaryMembers(header)) {
		const match = /^([^=]+)=:([A-Za-z0-9+/]*={0,2}):$/.exec(memberText.trim());
		if (!match) return null;
		let bytes;
		try {
			bytes = base64Decode(match[2]);
		} catch {
			return null;
		}
		signatures[match[1].trim()] = bytes;
	}
	return signatures;
}
/**
* Build the signature base for the covered components. Only the derived
* components an HTTP verifier can compute from a Web `Request` are supported;
* an unrecognized component fails the whole verification.
*/
function buildSignatureBase(request, member) {
	const url = new URL(request.url);
	const lines = [];
	for (const component of member.components) {
		let value = null;
		if (component.startsWith("@")) switch (component) {
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
			default: return null;
		}
		else {
			const headerValue = request.headers.get(component);
			if (headerValue === null) return null;
			value = headerValue.trim().replace(/[\r\n]+\s*/g, " ");
		}
		lines.push(`"${component}": ${value}`);
	}
	lines.push(`"@signature-params": ${member.raw}`);
	return lines.join("\n");
}
const encoder = new TextEncoder();
function base64UrlDecode(value) {
	return base64Decode(value.replace(/-/g, "+").replace(/_/g, "/"));
}
function base64Decode(value) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
function base64UrlEncode(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
* RFC 8037 Appendix A.3 JWK thumbprint for an Ed25519 public key: SHA-256
* over the canonical `{"crv","kty","x"}` JSON, base64url encoded. This is
* the `keyid` Web Bot Auth agents send.
*/
async function ed25519JwkThumbprint(x) {
	const canonical = JSON.stringify({
		crv: "Ed25519",
		kty: "OKP",
		x
	});
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
	return base64UrlEncode(new Uint8Array(digest));
}
/** Directory cache: origin → { keys, expiresAt (ms) }. Per-instance, best effort. */
const directoryCache = /* @__PURE__ */ new Map();
async function resolveStaticKey(keys, keyId) {
	for (const key of keys ?? []) {
		if (typeof key.x !== "string" || key.x === "") continue;
		if ((key.kid ?? await ed25519JwkThumbprint(key.x)) === keyId) return {
			keyId,
			x: key.x,
			agent: key.agent ?? null
		};
	}
	return null;
}
/**
* Fetch and parse an agent's key directory (JWKS) with strict validation:
* https only, allowlisted origin, no redirects, response size cap, Ed25519
* OKP keys only, and each key's thumbprint must match its advertised `kid`
* (when present). Failures return an empty key set — fail closed.
*/
async function fetchAgentDirectory(origin, cacheTtlSeconds, fetchImpl) {
	const cached = directoryCache.get(origin);
	if (cached && cached.expiresAt > Date.now()) return cached.keys;
	let keys = [];
	try {
		const response = await fetchImpl(`${origin}${SIGNATURE_AGENT_DIRECTORY_PATH}`, {
			redirect: "error",
			signal: AbortSignal.timeout(DIRECTORY_FETCH_TIMEOUT_MS),
			headers: { accept: "application/http-message-signatures-directory+json" }
		});
		if (response.ok) {
			const body = await readBodyWithCap(response, DIRECTORY_MAX_BYTES);
			keys = await parseDirectoryJwks(body === null ? null : JSON.parse(body));
		}
	} catch {
		keys = [];
	}
	directoryCache.set(origin, {
		keys,
		expiresAt: Date.now() + cacheTtlSeconds * 1e3
	});
	return keys;
}
async function readBodyWithCap(response, maxBytes) {
	if (Number(response.headers.get("content-length") ?? "0") > maxBytes) return null;
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const buffer = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(buffer);
}
/** Parse a JWKS payload into Ed25519 keys keyed by thumbprint. Invalid entries are dropped. */
async function parseDirectoryJwks(parsed) {
	if (!parsed || typeof parsed !== "object") return [];
	const rawKeys = parsed.keys;
	if (!Array.isArray(rawKeys)) return [];
	const keys = [];
	for (const entry of rawKeys) {
		if (!entry || typeof entry !== "object") continue;
		const jwk = entry;
		if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") continue;
		const thumbprint = await ed25519JwkThumbprint(jwk.x);
		if (typeof jwk.kid === "string" && jwk.kid !== thumbprint) continue;
		keys.push({
			keyId: thumbprint,
			x: jwk.x,
			agent: null
		});
	}
	return keys;
}
/**
* Verify a Web Bot Auth signature on the request. Resolves to the verified
* agent identity, or `null` when the request is unsigned or verification
* fails for any reason (fail closed — this function never throws).
*/
async function verifyAgentSignature(request, options) {
	try {
		return await verifyAgentSignatureUnsafe(request, options);
	} catch {
		return null;
	}
}
async function verifyAgentSignatureUnsafe(request, options) {
	const signatureInputHeader = request.headers.get("signature-input");
	const signatureHeader = request.headers.get("signature");
	if (!signatureInputHeader || !signatureHeader) return null;
	const members = parseSignatureInput(signatureInputHeader);
	const signatures = parseSignatureHeader(signatureHeader);
	if (!members || !signatures) return null;
	const now = options.now?.() ?? Math.floor(Date.now() / 1e3);
	const skew = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
	const maxLifetime = options.maxLifetimeSeconds ?? DEFAULT_MAX_LIFETIME_SECONDS;
	const signatureAgentHeader = request.headers.get("signature-agent");
	const agentUrl = signatureAgentHeader ? parseSignatureAgent(signatureAgentHeader) : null;
	if (signatureAgentHeader && !agentUrl) return null;
	for (const member of members) {
		if (member.params.tag !== WEB_BOT_AUTH_TAG) continue;
		const signature = signatures[member.label];
		if (!signature) continue;
		if (!member.components.includes("@authority")) continue;
		if (signatureAgentHeader && !member.components.includes("signature-agent")) continue;
		const { created, expires, keyid, alg } = member.params;
		if (typeof created !== "number" || typeof expires !== "number") continue;
		if (typeof keyid !== "string" || keyid === "") continue;
		if (alg !== void 0 && alg !== "ed25519") continue;
		if (expires <= created || expires - created > maxLifetime) continue;
		if (created > now + skew) continue;
		if (expires < now - skew) continue;
		let key = await resolveStaticKey(options.keys, keyid);
		let resolvedFromDirectory = false;
		let agentDomain = key?.agent ?? null;
		if (!key && agentUrl) {
			if ((options.directories ?? []).some((directory) => normalizeOrigin(directory) === agentUrl.origin)) {
				key = (await fetchAgentDirectory(agentUrl.origin, options.directoryCacheTtlSeconds ?? DEFAULT_DIRECTORY_CACHE_TTL_SECONDS, options.fetchImpl ?? fetch)).find((candidate) => candidate.keyId === keyid) ?? null;
				resolvedFromDirectory = key !== null;
			}
		}
		if (!key) continue;
		if (resolvedFromDirectory && agentUrl) agentDomain = agentUrl.host;
		const base = buildSignatureBase(request, member);
		if (base === null) continue;
		const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(base64UrlDecode(key.x)), { name: "Ed25519" }, false, ["verify"]);
		if (await crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, toArrayBuffer(signature), encoder.encode(base))) return {
			verified: true,
			agentDomain,
			keyId: keyid
		};
	}
	return null;
}
/** Copy into a fresh ArrayBuffer — some WebCrypto impls reject SharedArrayBuffer views. */
function toArrayBuffer(bytes) {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
/** Parse the Signature-Agent sf-string into a validated https URL. */
function parseSignatureAgent(header) {
	const trimmed = header.trim();
	let value = trimmed;
	if (trimmed.startsWith("\"")) {
		if (!trimmed.endsWith("\"") || trimmed.length < 2) return null;
		value = unescapeSfString(trimmed.slice(1, -1));
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:") return null;
	if (url.username !== "" || url.password !== "") return null;
	return url;
}
function normalizeOrigin(value) {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}
//#endregion
export { ed25519JwkThumbprint, verifyAgentSignature };
