import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { PRACHT_REVALIDATE_ENDPOINT, RevalidationReport, applyDefaultSecurityHeaders, classifyRevalidationSkip, createBaseRedirectResponse, createISGRegenerationRequest, createRevalidationSingleFlight, getTimeRevalidateSeconds, handlePrachtRequest, isCacheableISGResponse, jsonResponse, matchAppRoute, prefersMarkdown, preventHeuristicCaching, readRevalidationRequest, resolveRevalidationToken, restoreBasePathInRequest, routeSupportsMarkdown, stripBase } from "@pracht/core/server";
import { promisify } from "node:util";
import { brotliCompress, constants, createBrotliCompress, createGzip, gzip } from "node:zlib";
import { Readable } from "node:stream";
/**
* Whole-file compression uses the libuv worker pool and retains both source
* and encoded buffers until the job completes. Keep a cold burst across many
* distinct paths from queuing an unbounded amount of that work; overflow uses
* the streaming compression path instead.
*/
const MAX_PENDING_ASSET_COMPRESSIONS = 8;
const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const COMPRESSIBLE_MIME_TYPES = new Set([
	"application/ecmascript",
	"application/javascript",
	"application/json",
	"application/wasm",
	"application/x-javascript",
	"application/xml"
]);
const INTEGRITY_HEADER_NAMES = [
	"content-digest",
	"repr-digest",
	"digest",
	"content-md5"
];
const ENCODED_ETAG_PATTERN = /^(?:W\/)?"pracht-(?:br|gzip)-[A-Za-z0-9_-]{43}"$/;
/**
* Whether a `Content-Type` names a representation that compresses well.
* `text/*`, well-known application types, and any `+json`/`+xml` structured
* syntax suffix (`image/svg+xml`, `application/manifest+json`, ...). Binary
* media (images, fonts, video, archives) is already compressed and excluded.
*/
function isCompressibleContentType(value) {
	if (!value) return false;
	const mime = value.split(";")[0].trim().toLowerCase();
	if (mime.startsWith("text/")) return true;
	if (COMPRESSIBLE_MIME_TYPES.has(mime)) return true;
	return mime.endsWith("+json") || mime.endsWith("+xml");
}
/**
* Pick the response encoding for an `Accept-Encoding` header. Honors
* q-values, `*` wildcards, and explicit `q=0` exclusions. Per RFC 9110
* §12.5.3 the acceptable coding with the highest non-zero qvalue is
* preferred; an explicitly higher `identity` preference wins, while brotli
* wins ties (including the common unweighted `gzip, deflate, br`). Returns
* `null` (identity) when neither coding is acceptable — including
* `identity;q=0` alone, where falling back to an uncompressed 200 is the
* robust interpretation of the SHOULD-level 406.
*/
function negotiateEncoding(header) {
	if (!header) return null;
	const qualities = /* @__PURE__ */ new Map();
	for (const part of header.split(",")) {
		const [token, ...params] = part.trim().split(";");
		const name = token?.trim().toLowerCase();
		if (!name) continue;
		let quality = 1;
		for (const param of params) {
			const [key, value] = param.trim().split("=");
			if (key?.trim().toLowerCase() !== "q") continue;
			const parsed = Number.parseFloat(value ?? "");
			if (!Number.isNaN(parsed)) quality = parsed;
		}
		qualities.set(name === "x-gzip" ? "gzip" : name, quality);
	}
	const qualityOf = (encoding) => qualities.get(encoding) ?? qualities.get("*") ?? 0;
	const brQuality = qualityOf("br");
	const gzipQuality = qualityOf("gzip");
	const encoding = brQuality >= gzipQuality ? "br" : "gzip";
	const encodingQuality = Math.max(brQuality, gzipQuality);
	const identityQuality = qualities.get("identity");
	if (identityQuality !== void 0 && identityQuality > encodingQuality) return null;
	return encodingQuality > 0 ? encoding : null;
}
/**
* Whether a response may be transformed at all: informational/empty/not-
* modified statuses have no body to compress, Range responses would corrupt
* byte offsets, an existing `Content-Encoding` means someone already encoded
* the body, and `Cache-Control: no-transform` is an explicit opt-out.
*/
function isTransformableResponse(status, headers) {
	if (status < 200 || status === 204 || status === 205 || status === 206 || status === 304) return false;
	const existingEncoding = headers.get("content-encoding");
	if (existingEncoding && existingEncoding.toLowerCase() !== "identity") return false;
	if (headers.has("content-range")) return false;
	const cacheControl = headers.get("cache-control");
	if (cacheControl && /(?:^|[\s,])no-transform(?:$|[\s,;=])/i.test(cacheControl)) return false;
	if (INTEGRITY_HEADER_NAMES.some((name) => headers.has(name))) return false;
	return true;
}
/** Append `Accept-Encoding` to a `Vary` header value, preserving existing members. */
function mergeVaryValue(existing) {
	if (!existing) return "Accept-Encoding";
	const members = existing.split(",").map((member) => member.trim().toLowerCase());
	if (members.includes("*") || members.includes("accept-encoding")) return existing;
	return `${existing}, Accept-Encoding`;
}
/** Merge `Accept-Encoding` into the `Vary` header already written to `res`. */
function mergeVaryOnNodeResponse(res) {
	const existing = res.getHeader("vary");
	const value = Array.isArray(existing) ? existing.join(", ") : existing?.toString() ?? null;
	res.setHeader("vary", mergeVaryValue(value));
}
/**
* Derive the ETag of an encoded variant from the identity ETag. Encoded
* variants must not share a validator with identity — a shared tag would let
* a cache answer an `Accept-Encoding: identity` revalidation with a brotli
* body — so the encoding is folded into the opaque tag. The derived tag is
* always weak: streaming compression can produce different wire bytes for the
* same decoded content when source chunk boundaries differ.
*/
function encodeEtagForEncoding(etag, encoding) {
	const opaqueTag = etag.startsWith("W/") ? etag.slice(2) : etag;
	return `W/"pracht-${encoding}-${createHash("sha256").update(opaqueTag).update("\0").update(encoding).digest("base64url")}"`;
}
/**
* Build a handler-local file version for compression caches. ISG writes
* replace the file atomically, so the inode changes even when a same-size
* rewrite lands on a filesystem whose timestamps are too coarse to move.
* `ctimeMs` is included as a fallback for filesystems that do not expose useful
* inode numbers. This version must never enter a public validator: device,
* inode, and ctime values differ across replica-local copies of identical
* files.
*/
function createCompressionFileVersion(fileStat) {
	return [
		fileStat.dev,
		fileStat.ino,
		fileStat.size,
		fileStat.mtimeMs,
		fileStat.ctimeMs
	].join(":");
}
/**
* Keep an application identity tag out of the namespace used for encoded
* variants. Without this escape, an application that later adopts a tag equal
* to an older encoded validator could still make a cross-representation
* `If-None-Match` request look current despite collision-resistant derivation.
*/
function protectIdentityEtag(etag) {
	if (!ENCODED_ETAG_PATTERN.test(etag)) return etag;
	const opaqueTag = etag.startsWith("W/") ? etag.slice(2) : etag;
	return `W/"pracht-identity-${createHash("sha256").update(opaqueTag).update("\0identity").digest("base64url")}"`;
}
/** Whether an `If-None-Match` list contains one of this adapter's encoded tags. */
function containsEncodedEtag(header) {
	return header?.split(",").some((candidate) => ENCODED_ETAG_PATTERN.test(candidate.trim())) ?? false;
}
/**
* Weakly compare an `If-None-Match` list with the selected representation's
* ETag. Commas inside the quoted opaque tag are data, not list separators.
*/
function matchesIfNoneMatch(header, etag) {
	if (!header) return false;
	const candidates = parseEntityTagList(header);
	if (candidates.includes("*")) return true;
	if (!etag) return false;
	const weakOpaqueTag = (value) => value.startsWith("W/") ? value.slice(2) : value;
	const expected = weakOpaqueTag(etag);
	return candidates.some((candidate) => weakOpaqueTag(candidate) === expected);
}
/** Strongly compare an `If-Match` list with the selected representation's ETag. */
function matchesIfMatch(header, etag) {
	if (!header) return true;
	const candidates = parseEntityTagList(header);
	if (candidates.includes("*")) return true;
	if (!etag || etag.startsWith("W/")) return false;
	return candidates.some((candidate) => !candidate.startsWith("W/") && candidate === etag);
}
function parseEntityTagList(header) {
	const candidates = [];
	let start = 0;
	let quoted = false;
	for (let index = 0; index < header.length; index += 1) {
		const character = header[index];
		if (character === "\"") quoted = !quoted;
		else if (character === "," && !quoted) {
			candidates.push(header.slice(start, index).trim());
			start = index + 1;
		}
	}
	candidates.push(header.slice(start).trim());
	return candidates;
}
/**
* Evaluate conditional GET/HEAD validators against the selected response
* representation. `If-None-Match` takes precedence over
* `If-Modified-Since`, as required by RFC 9110 section 13.1.3.
*/
function isNotModifiedRequest(request, etag, lastModified) {
	const ifNoneMatch = request.headers.get("if-none-match");
	if (ifNoneMatch) return matchesIfNoneMatch(ifNoneMatch, etag);
	const ifModifiedSince = request.headers.get("if-modified-since");
	if (!lastModified || !ifModifiedSince) return false;
	const modifiedTime = Date.parse(lastModified);
	const sinceTime = Date.parse(ifModifiedSince);
	return !Number.isNaN(modifiedTime) && !Number.isNaN(sinceTime) && modifiedTime <= sinceTime;
}
/**
* Create a streaming zlib transform for `encoding`. Brotli runs at quality 4
* for streamed (dynamic) bodies — near-gzip speed with a better ratio —
* because SSR latency matters more than the last few percent of savings.
*/
function createCompressionTransform(encoding, options = {}) {
	if (encoding === "br") {
		const params = { [constants.BROTLI_PARAM_QUALITY]: 4 };
		if (options.sizeHint !== void 0) params[constants.BROTLI_PARAM_SIZE_HINT] = options.sizeHint;
		return createBrotliCompress({
			params,
			...options.incremental ? { flush: constants.BROTLI_OPERATION_FLUSH } : {}
		});
	}
	return createGzip(options.incremental ? { flush: constants.Z_SYNC_FLUSH } : {});
}
/**
* Pipe `source` through a compression transform, keeping the failure
* semantics `pipeToResponse()` relies on: a source error destroys the
* transform with that error (so the caller can still answer 500), and a
* transform torn down mid-stream (client disconnect) releases the source so
* file descriptors and pooled sockets do not leak.
*/
function createCompressedStream(source, encoding, options = {}) {
	const transform = createCompressionTransform(encoding, options);
	source.on("error", (error) => {
		transform.destroy(error instanceof Error ? error : new Error(String(error)));
	});
	transform.on("close", () => {
		if (!transform.writableFinished) {
			source.unpipe?.(transform);
			source.destroy?.();
		}
	});
	source.pipe(transform);
	return transform;
}
/**
* Compress a whole buffer at higher quality than the streaming path — used
* for static assets whose result lands in the LRU, where the one-time CPU
* cost is amortized across every later request.
*/
function compressBuffer(buffer, encoding) {
	if (encoding === "br") return brotliCompressAsync(buffer, { params: {
		[constants.BROTLI_PARAM_QUALITY]: 9,
		[constants.BROTLI_PARAM_SIZE_HINT]: buffer.byteLength
	} });
	return gzipAsync(buffer, { level: 9 });
}
/**
* Byte-bounded LRU of compressed static assets. Callers include a per-path
* write generation in each key so an ISG rewrite invalidates cached bytes even
* when the replacement has the same size and filesystem timestamp.
* Whole-buffer compression and content-derived validator work are also byte-
* and concurrency-bounded while pending.
*/
var CompressedAssetCache = class {
	#entries = /* @__PURE__ */ new Map();
	#fileEtags = /* @__PURE__ */ new Map();
	#pathGenerations = /* @__PURE__ */ new Map();
	#pending = /* @__PURE__ */ new Map();
	#pendingFileEtags = /* @__PURE__ */ new Map();
	#pendingBytes = 0;
	#pendingFileEtagBytes = 0;
	#totalBytes = 0;
	#maxBytes;
	#maxPendingEntries;
	constructor(maxBytes = 32 * 1024 * 1024, maxPendingEntries = MAX_PENDING_ASSET_COMPRESSIONS) {
		this.#maxBytes = maxBytes;
		this.#maxPendingEntries = maxPendingEntries;
	}
	get totalBytes() {
		return this.#totalBytes;
	}
	getPathGeneration(path) {
		return this.#pathGenerations.get(path) ?? 0;
	}
	/**
	* Advance the generation for a mutable file and discard its completed cache
	* entries. In-flight work may still finish for the old generation, but a
	* later request cannot select it because its key includes the new value.
	*/
	invalidatePath(path) {
		this.#pathGenerations.set(path, this.getPathGeneration(path) + 1);
		const prefix = `${path}\0`;
		for (const [key, value] of this.#entries) {
			if (!key.startsWith(prefix)) continue;
			this.#entries.delete(key);
			this.#totalBytes -= value.byteLength;
		}
		for (const key of this.#fileEtags.keys()) if (key.startsWith(prefix)) this.#fileEtags.delete(key);
	}
	/**
	* Cache a content-derived public validator by path + local file version.
	* The key may contain replica-local metadata because it never leaves this
	* process; `produce()` must return a validator derived only from public,
	* replica-stable representation data. Returns `null` when admitting a new
	* key would exceed the pending byte or concurrency budget; callers must omit
	* the validator for that response rather than fall back to mutable filesystem
	* metadata.
	*/
	getOrCreateFileEtag(key, estimatedBytes, produce) {
		const cached = this.#fileEtags.get(key);
		if (cached !== void 0) {
			this.#fileEtags.delete(key);
			this.#fileEtags.set(key, cached);
			return Promise.resolve(cached);
		}
		let pending = this.#pendingFileEtags.get(key);
		if (!pending) {
			if (this.#pendingFileEtags.size >= this.#maxPendingEntries || estimatedBytes > this.#maxBytes - this.#pendingFileEtagBytes) return null;
			this.#pendingFileEtagBytes += estimatedBytes;
			pending = Promise.resolve().then(produce).then((etag) => {
				this.#fileEtags.set(key, etag);
				while (this.#fileEtags.size > 1024) {
					const oldest = this.#fileEtags.keys().next().value;
					if (oldest === void 0) break;
					this.#fileEtags.delete(oldest);
				}
				return etag;
			}).finally(() => {
				this.#pendingFileEtags.delete(key);
				this.#pendingFileEtagBytes -= estimatedBytes;
			});
			this.#pendingFileEtags.set(key, pending);
		}
		return pending;
	}
	/**
	* Cached lookup with in-flight deduplication: concurrent first requests to
	* the same file version share one `produce()` call instead of compressing
	* the same bytes N times (the post-deploy thundering herd). A failed
	* `produce()` rejects every waiter and is not cached, so the next request
	* retries. Returns `null` when admitting a new key would exceed the pending
	* byte or concurrency budget so the caller can stream it instead.
	*/
	getOrCompress(key, estimatedBytes, produce) {
		const cached = this.get(key);
		if (cached !== void 0) return Promise.resolve(cached);
		let pending = this.#pending.get(key);
		if (!pending) {
			if (this.#pending.size >= this.#maxPendingEntries || estimatedBytes > this.#maxBytes - this.#pendingBytes) return null;
			this.#pendingBytes += estimatedBytes;
			pending = Promise.resolve().then(produce).then((buffer) => {
				this.set(key, buffer);
				return buffer;
			}).finally(() => {
				this.#pending.delete(key);
				this.#pendingBytes -= estimatedBytes;
			});
			this.#pending.set(key, pending);
		}
		return pending;
	}
	get(key) {
		const entry = this.#entries.get(key);
		if (entry === void 0) return void 0;
		this.#entries.delete(key);
		this.#entries.set(key, entry);
		return entry;
	}
	set(key, value) {
		if (value.byteLength > this.#maxBytes) return;
		const existing = this.#entries.get(key);
		if (existing !== void 0) {
			this.#entries.delete(key);
			this.#totalBytes -= existing.byteLength;
		}
		this.#entries.set(key, value);
		this.#totalBytes += value.byteLength;
		for (const [oldestKey, oldestValue] of this.#entries) {
			if (this.#totalBytes <= this.#maxBytes) break;
			this.#entries.delete(oldestKey);
			this.#totalBytes -= oldestValue.byteLength;
		}
	}
};
//#endregion
//#region src/node-isg.ts
const regenerationSingleFlight = createRevalidationSingleFlight();
/**
* Publish an ISG snapshot as one filesystem replacement. Besides preventing
* readers from observing a partially-written document, the replacement gives
* the file a new durable identity so validators and compression caches in
* restarted or sibling Node workers cannot alias a same-size rewrite whose
* mtime is unchanged on a coarse-timestamp filesystem.
*/
async function writeISGFile(htmlPath, html) {
	const directory = dirname(htmlPath);
	await mkdir(directory, { recursive: true });
	const existing = await stat(htmlPath).catch(() => null);
	const temporaryPath = join(directory, `.${basename(htmlPath)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, html, {
			encoding: "utf-8",
			flush: true,
			...existing ? { mode: existing.mode & 511 } : {}
		});
		await rename(temporaryPath, htmlPath);
	} finally {
		await rm(temporaryPath, { force: true }).catch(() => void 0);
	}
}
/**
* Regenerate an ISG page and write it to disk. Returns `true` when fresh
* HTML was written, `false` when the render did not produce cacheable
* 200 HTML (the stale on-disk copy is kept in that case).
*/
async function regenerateISGPage(options, pathname, htmlPath, contextArgs) {
	return regenerationSingleFlight(htmlPath, async () => {
		const request = restoreBasePathInRequest(createISGRegenerationRequest(pathname, contextArgs?.request));
		const context = options.createContext && contextArgs ? await options.createContext({
			...contextArgs,
			request
		}) : void 0;
		const response = await handlePrachtRequest({
			app: options.app,
			basePathStripped: false,
			context,
			registry: options.registry,
			request,
			clientEntryUrl: options.clientEntryUrl,
			islandsEntryUrl: options.islandsEntryUrl,
			islandsBootstrapRequired: options.islandsBootstrapRequired,
			cssManifest: options.cssManifest,
			jsManifest: options.jsManifest
		});
		if (response.status !== 200 || !isCacheableISGResponse(response)) return false;
		await writeISGFile(htmlPath, await response.text());
		return true;
	});
}
//#endregion
//#region src/node-request.ts
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
/**
* Node error codes that mean "the client went away mid-response", not "the
* server broke". `http.createServer()` does not await the handler's promise,
* so letting one of these reject would surface as an unhandled rejection and
* (on Node >= 15) terminate the process — a client pressing Escape would take
* the server down with it.
*/
const CLIENT_DISCONNECT_CODES = new Set([
	"ECONNRESET",
	"EPIPE",
	"ERR_STREAM_DESTROYED",
	"ERR_STREAM_PREMATURE_CLOSE"
]);
/**
* Whether `error` is a client disconnect rather than a server-side failure.
*
* Walks the `cause` chain because a transport wraps the underlying failure
* (undici reports a peer reset as `TypeError: terminated` with
* `cause.code === "ECONNRESET"`). The walk is iterative and cycle-guarded: a
* self-referential or mutually-referential `cause` is legal JavaScript, and
* recursing on it would throw `RangeError` from inside the handler's own
* catch block — turning the crash this function exists to prevent back into an
* unhandled rejection.
*/
function isClientDisconnectError(error) {
	const seen = /* @__PURE__ */ new Set();
	let current = error;
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		const code = current.code;
		if (typeof code === "string" && CLIENT_DISCONNECT_CODES.has(code)) return true;
		current = current.cause;
	}
	return false;
}
/**
* Pipe `source` into `res`, resolving when the client goes away and rejecting
* only when the *source* fails.
*
* Deliberately not `stream.pipeline()`. Pipeline destroys every stream it was
* given on any failure — including calling `destroy(err)` on the source when
* the destination dies — so afterwards `req.aborted`, `req.destroyed`,
* `res.destroyed`, and "the source emitted an error" are all true whether the
* client hung up or an upstream `fetch()` body blew up. Nothing is left to
* classify on. The error code cannot stand in either: undici surfaces a TCP
* reset from a proxied backend as `TypeError: terminated` with
* `cause.code === "ECONNRESET"`, so a backend outage would be filed as a
* client disconnect and vanish from the logs.
*
* Owning the plumbing keeps the two sides distinguishable, and leaves `res`
* intact after a source failure so the caller can still answer `500` when
* nothing has been written yet.
*/
function pipeToResponse(source, res) {
	return new Promise((resolveWrite, rejectWrite) => {
		let settled = false;
		const cleanup = () => {
			res.off("error", onResponseError);
			res.off("close", onResponseClose);
			res.off("finish", onFinish);
		};
		const succeed = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolveWrite();
		};
		const fail = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			rejectWrite(error);
		};
		/** The client is gone: stop reading so the source cannot leak. */
		const abandonSource = () => {
			source.unpipe?.(res);
			source.destroy?.();
		};
		function onSourceError(error) {
			source.unpipe?.(res);
			fail(error);
		}
		function onResponseError(error) {
			abandonSource();
			if (isClientDisconnectError(error)) succeed();
			else fail(error);
		}
		function onResponseClose() {
			if (!res.writableFinished) abandonSource();
			succeed();
		}
		function onFinish() {
			succeed();
		}
		source.on("error", onSourceError);
		res.on("error", onResponseError);
		res.on("close", onResponseClose);
		res.on("finish", onFinish);
		if (res.destroyed || res.writableEnded) {
			abandonSource();
			succeed();
			return;
		}
		source.pipe(res);
	});
}
async function createWebRequest(req, options) {
	const baseUrl = resolveRequestBase(req, options);
	const url = new URL(normalizeRequestTarget(req.url, options), baseUrl);
	const method = req.method ?? "GET";
	const init = {
		headers: createHeaders(req.headers),
		method
	};
	if (!BODYLESS_METHODS.has(method.toUpperCase())) {
		const body = await readRequestBody(req, options.maxBodySize ?? 1048576);
		if (body.byteLength > 0) {
			const exactBody = new Uint8Array(body.byteLength);
			exactBody.set(body);
			init.body = exactBody.buffer;
		}
	}
	return new Request(url, init);
}
function normalizeRequestTarget(rawTarget, options) {
	const target = rawTarget ?? "/";
	if (!options.canonicalOrigin) return target;
	if (target.startsWith("//")) {
		const networkPathUrl = new URL(`https:${target}`);
		return `${networkPathUrl.pathname}${networkPathUrl.search}${networkPathUrl.hash}`;
	}
	if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(target)) {
		const absoluteUrl = new URL(target);
		return `${absoluteUrl.pathname}${absoluteUrl.search}${absoluteUrl.hash}`;
	}
	return target;
}
async function writeWebResponse(res, response, compression) {
	res.statusCode = response.status;
	res.statusMessage = response.statusText;
	writeNodeResponseHeaders(res, response.headers);
	let encoding = null;
	const sourceEtag = getNodeHeaderValue(res, "etag");
	const sourceEncoding = response.headers.get("content-encoding");
	if (compression && sourceEtag && (!sourceEncoding || sourceEncoding.toLowerCase() === "identity")) res.setHeader("etag", protectIdentityEtag(sourceEtag));
	const compressibleContentType = isCompressibleContentType(response.headers.get("content-type"));
	if (compression && (compressibleContentType || response.status === 304)) mergeVaryOnNodeResponse(res);
	if (compression && !compression.request.headers.has("range") && compressibleContentType && isTransformableResponse(response.status, response.headers)) {
		const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
		const belowThreshold = !Number.isNaN(contentLength) && contentLength < 1024;
		if ((response.body || compression.request.method === "HEAD") && !belowThreshold) encoding = negotiateEncoding(compression.request.headers.get("accept-encoding"));
		if (encoding) {
			res.removeHeader("content-length");
			res.setHeader("content-encoding", encoding);
			if (sourceEtag) res.setHeader("etag", encodeEtagForEncoding(sourceEtag, encoding));
		}
	}
	const responseEtag = getNodeHeaderValue(res, "etag");
	const isSuccessfulRetrieval = compression && response.status >= 200 && response.status < 300 && (compression.request.method === "GET" || compression.request.method === "HEAD");
	if (isSuccessfulRetrieval && compression.ownsIfMatch && !matchesIfMatch(compression.request.headers.get("if-match"), responseEtag)) {
		res.statusCode = 412;
		res.statusMessage = "Precondition Failed";
		for (const name of [
			"content-digest",
			"content-encoding",
			"content-length",
			"content-md5",
			"content-range",
			"content-type",
			"digest",
			"repr-digest"
		]) res.removeHeader(name);
		res.setHeader("cache-control", "no-store");
		cancelResponseBody(response);
		res.end();
		return;
	}
	if (isSuccessfulRetrieval && isNotModifiedRequest(compression.request, responseEtag, getNodeHeaderValue(res, "last-modified"))) {
		res.statusCode = 304;
		res.statusMessage = "Not Modified";
		res.removeHeader("content-length");
		res.removeHeader("content-range");
		cancelResponseBody(response);
		res.end();
		return;
	}
	if (!response.body) {
		res.end();
		return;
	}
	const source = Readable.fromWeb(response.body);
	await pipeToResponse(encoding ? createCompressedStream(source, encoding, { incremental: true }) : source, res);
}
function cancelResponseBody(response) {
	if (!response.body) return;
	response.body.cancel().catch(() => void 0);
}
function getNodeHeaderValue(res, name) {
	const value = res.getHeader(name);
	return Array.isArray(value) ? value.join(", ") : value?.toString() ?? null;
}
function writeNodeResponseHeaders(res, headers) {
	const setCookieHeaders = getSetCookieHeaders(headers);
	headers.forEach((value, key) => {
		if (key.toLowerCase() === "set-cookie" && setCookieHeaders.length > 0) return;
		res.setHeader(key, value);
	});
	if (setCookieHeaders.length > 0) res.setHeader("set-cookie", setCookieHeaders);
}
function getSetCookieHeaders(headers) {
	const getSetCookie = headers.getSetCookie;
	return typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
}
/**
* Derive the request base URL from the incoming message.
*
* When `canonicalOrigin` is provided, it wins and request URL construction no
* longer depends on `Host` / forwarded host headers. This is the safest option
* for apps that generate absolute URLs from `request.url`.
*
* Otherwise, when `trustProxy` is false (default), the protocol is inferred
* from the socket's TLS state and the host from the HTTP `Host` header.
* Forwarded headers are ignored entirely.
*
* When `trustProxy` is true, the following precedence applies for the derived
* host/protocol:
*   1. RFC 7239 `Forwarded` header (`proto=` / `host=` directives)
*   2. `X-Forwarded-Proto` / `X-Forwarded-Host`
*   3. Socket-derived values (fallback)
*/
function resolveRequestBase(req, options) {
	if (options.canonicalOrigin) return new URL(options.canonicalOrigin);
	const { protocol, host } = resolveOrigin(req, options.trustProxy);
	return new URL(`${protocol}://${host}`);
}
function resolveOrigin(req, trustProxy) {
	const socketProtocol = "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
	const socketHost = getFirstHeaderValue(req.headers.host) ?? "localhost";
	if (!trustProxy) return {
		protocol: socketProtocol,
		host: socketHost
	};
	const forwarded = getFirstHeaderValue(req.headers.forwarded);
	if (forwarded) {
		const parsed = parseForwardedHeader(forwarded);
		return {
			protocol: parsed.proto ?? getFirstHeaderValue(req.headers["x-forwarded-proto"]) ?? socketProtocol,
			host: parsed.host ?? getFirstHeaderValue(req.headers["x-forwarded-host"]) ?? socketHost
		};
	}
	return {
		protocol: getFirstHeaderValue(req.headers["x-forwarded-proto"]) ?? socketProtocol,
		host: getFirstHeaderValue(req.headers["x-forwarded-host"]) ?? socketHost
	};
}
/**
* Parse the first element of an RFC 7239 `Forwarded` header, extracting
* `proto` and `host` directives.  Returns `undefined` for directives that
* are not present.
*/
function parseForwardedHeader(value) {
	const first = value.split(",")[0];
	const result = {};
	for (const part of first.split(";")) {
		const [key, val] = part.trim().split("=");
		if (!key || !val) continue;
		const k = key.toLowerCase();
		const v = val.replace(/^"|"$/g, "");
		if (k === "proto") result.proto = v;
		else if (k === "host") result.host = v;
	}
	return result;
}
function createHeaders(headers) {
	const result = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "undefined") continue;
		if (Array.isArray(value)) {
			for (const entry of value) result.append(key, entry);
			continue;
		}
		result.set(key, value);
	}
	return result;
}
async function readRequestBody(req, maxBodySize) {
	const chunks = [];
	let totalSize = 0;
	for await (const chunk of req) {
		const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		totalSize += buf.byteLength;
		if (totalSize > maxBodySize) throw new Error("Request body too large");
		chunks.push(buf);
	}
	return Buffer.concat(chunks);
}
function getFirstHeaderValue(value) {
	if (Array.isArray(value)) return value[0];
	return value;
}
//#endregion
//#region src/node-static.ts
const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".markdown": "text/markdown; charset=utf-8",
	".xml": "application/xml",
	".webmanifest": "application/manifest+json",
	".wasm": "application/wasm"
};
/**
* Hashed assets (e.g. `assets/chunk-AbCd1234.js`) are safe to cache
* indefinitely.  Everything else gets a conservative policy.
*/
const HASHED_ASSET_RE = /\/assets\//;
function getCacheControl(urlPath) {
	if (HASHED_ASSET_RE.test(urlPath)) return "public, max-age=31536000, immutable";
	return "public, max-age=0, must-revalidate";
}
/**
* Resolve a URL pathname to a static file inside `staticDir`.
*
* Tries the exact path first (e.g. `/assets/chunk-Ab12.js`), then falls back
* to `{pathname}/index.html` for clean-URL pages (e.g. `/about` →
* `about/index.html`).  Returns `null` when no matching file is found.
*/
async function resolveStaticFile(staticDir, pathname, isgManifest = {}) {
	const staticRoot = resolve(staticDir);
	const exactPath = resolveUrlPath(staticRoot, pathname);
	if (!exactPath) return null;
	const exactStat = await lstat(exactPath).catch(() => null);
	if (exactStat?.isFile() && !exactStat.isSymbolicLink()) {
		if (!await realPathIsInside(staticRoot, exactPath)) return null;
		return {
			filePath: exactPath,
			contentType: MIME_TYPES[extname(exactPath)] || "application/octet-stream",
			cacheControl: getCacheControl(pathname)
		};
	}
	if (pathname in isgManifest) return null;
	const indexPath = pathname === "/" ? resolve(staticRoot, "index.html") : resolveUrlPath(staticRoot, pathname, "index.html");
	if (!indexPath) return null;
	const indexStat = await lstat(indexPath).catch(() => null);
	if (indexStat?.isFile() && !indexStat.isSymbolicLink()) {
		if (!await realPathIsInside(staticRoot, indexPath)) return null;
		return {
			filePath: indexPath,
			contentType: "text/html; charset=utf-8",
			cacheControl: "public, max-age=0, must-revalidate"
		};
	}
	return null;
}
function applyHeadersManifest(headers, headersManifest, pathname) {
	const routeHeaders = getManifestHeaders(headersManifest, pathname);
	if (!routeHeaders) return;
	for (const [key, value] of Object.entries(routeHeaders)) headers.set(key, value);
}
function getManifestHeaders(headersManifest, pathname) {
	const withoutIndex = pathname.replace(/\/index\.html$/, "") || "/";
	const withoutSlash = pathname.replace(/\/$/, "") || "/";
	return headersManifest[pathname] ?? headersManifest[withoutSlash] ?? headersManifest[withoutIndex] ?? void 0;
}
function resolveUrlPath(staticRoot, pathname, suffix) {
	if (pathname.includes("\0") || pathname.includes("\\")) return null;
	const candidate = suffix ? resolve(staticRoot, `.${pathname}`, suffix) : resolve(staticRoot, `.${pathname}`);
	return pathIsInside(staticRoot, candidate) ? candidate : null;
}
function pathIsInside(root, candidate) {
	return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}
async function realPathIsInside(staticRoot, candidate) {
	const [rootReal, candidateReal] = await Promise.all([realpath(staticRoot).catch(() => staticRoot), realpath(candidate).catch(() => null)]);
	return candidateReal !== null && pathIsInside(resolve(rootReal), resolve(candidateReal));
}
//#endregion
//#region src/node-handler.ts
const ROUTE_STATE_REQUEST_HEADER = "x-pracht-route-state-request";
let warnedAboutMissingCanonicalOrigin = false;
function createNodeRequestHandler(options) {
	const isgManifest = options.isgManifest ?? {};
	const headersManifest = options.headersManifest ?? {};
	const staticDir = options.staticDir;
	const trustProxy = options.trustProxy ?? false;
	const canonicalOrigin = options.canonicalOrigin;
	const maxBodySize = options.maxBodySize;
	const compressionEnabled = options.compression !== false;
	const compressedAssetCache = new CompressedAssetCache();
	if (maxBodySize !== void 0 && (!Number.isInteger(maxBodySize) || maxBodySize <= 0)) throw new Error("nodeAdapter({ maxBodySize }) expects a positive integer number of bytes.");
	const handle = async (req, res) => {
		if (!canonicalOrigin && shouldWarnAboutMissingCanonicalOrigin(staticDir)) {
			warnedAboutMissingCanonicalOrigin = true;
			console.warn("[pracht] @pracht/adapter-node is deriving request.url from Host headers. Set nodeAdapter({ canonicalOrigin }) for deployed Node apps to avoid host-header poisoning.");
		}
		let request;
		try {
			request = await createWebRequest(req, {
				canonicalOrigin,
				trustProxy,
				maxBodySize
			});
		} catch (err) {
			if (err instanceof Error && err.message === "Request body too large") {
				res.statusCode = 413;
				res.end("Payload Too Large");
				return;
			}
			throw err;
		}
		const baseRedirect = options.basePathStripped ? null : createBaseRedirectResponse(request);
		if (baseRedirect) {
			await writeWebResponse(res, baseRedirect);
			return;
		}
		const url = new URL(request.url);
		const routePathname = options.basePathStripped ? url.pathname : stripBase(url.pathname);
		const compression = compressionEnabled ? {
			cache: compressedAssetCache,
			request
		} : void 0;
		const isTransportRouteStateRequest = isRouteStateRequest(url, request.headers);
		const wantsMarkdown = prefersMarkdown(request.headers.get("accept")) && (options.markdownManifest === void 0 || routePathname !== null && routeSupportsMarkdown(options.markdownManifest, routePathname));
		if (routePathname === PRACHT_REVALIDATE_ENDPOINT) {
			await writeWebResponse(res, await handleRevalidationEndpoint(request, options, staticDir, isgManifest, {
				request,
				req,
				res
			}, compression), compression);
			return;
		}
		if (staticDir && isStaticAssetMethod(request.method) && !wantsMarkdown && !isTransportRouteStateRequest && routePathname !== null) {
			const staticResult = await resolveStaticFile(staticDir, routePathname, isgManifest);
			if (staticResult) {
				await serveStaticFile(request, res, staticResult, headersManifest, routePathname, compression);
				return;
			}
		}
		if (staticDir && isStaticAssetMethod(request.method) && !isTransportRouteStateRequest && !wantsMarkdown && routePathname !== null && routePathname in isgManifest) {
			if (await serveISGEntry(request, res, options, staticDir, routePathname, isgManifest[routePathname], headersManifest, {
				request,
				req,
				res
			}, compression)) return;
		}
		let applicationRequest = createApplicationRequest(request, compression);
		if (options.basePathStripped) applicationRequest = restoreBasePathInRequest(applicationRequest);
		const context = options.createContext ? await options.createContext({
			request: applicationRequest,
			req,
			res
		}) : void 0;
		const response = await handlePrachtRequest({
			app: options.app,
			basePathStripped: false,
			context,
			registry: options.registry,
			request: applicationRequest,
			apiRoutes: options.apiRoutes,
			clientEntryUrl: options.clientEntryUrl,
			islandsEntryUrl: options.islandsEntryUrl,
			islandsBootstrapRequired: options.islandsBootstrapRequired,
			cssManifest: options.cssManifest,
			jsManifest: options.jsManifest
		});
		const isIsgDocument = staticDir !== void 0 && request.method === "GET" && !isTransportRouteStateRequest && routePathname !== null && routePathname in isgManifest && response.status === 200 && (response.headers.get("content-type")?.includes("text/html") ?? false) && isCacheableISGResponse(response);
		if (isIsgDocument) {
			const html = await response.clone().text();
			const htmlPath = resolveContainedPath(staticDir, routePathname);
			if (htmlPath) {
				await writeISGFile(htmlPath, html);
				compressedAssetCache.invalidatePath(htmlPath);
			}
		}
		await writeWebResponse(res, isIsgDocument ? response : preventHeuristicCaching(request, response), compression);
	};
	return async (req, res) => {
		try {
			await handle(req, res);
		} catch (error) {
			if ((req.destroyed || res.destroyed || !res.writable) && isClientDisconnectError(error)) {
				if (!res.destroyed) res.destroy();
				return;
			}
			console.error("[pracht] Unhandled error while serving a request:", error);
			if (res.destroyed || res.headersSent || res.writableEnded) {
				if (!res.destroyed) res.destroy();
				return;
			}
			try {
				for (const name of res.getHeaderNames()) res.removeHeader(name);
				res.statusCode = 500;
				res.statusMessage = "Internal Server Error";
				writeNodeResponseHeaders(res, applyDefaultSecurityHeaders(new Headers({
					"cache-control": "no-store",
					"content-type": "text/plain; charset=utf-8"
				})));
				res.end("Internal Server Error");
			} catch {
				res.destroy();
			}
		}
	};
}
function shouldWarnAboutMissingCanonicalOrigin(staticDir) {
	if (warnedAboutMissingCanonicalOrigin) return false;
	if (process.env.NODE_ENV === "production") return true;
	return typeof staticDir === "string" && staticDir.length > 0;
}
async function serveStaticFile(request, res, staticResult, headersManifest, pathname, compression) {
	const file = await open(staticResult.filePath, "r");
	try {
		const fileStat = await file.stat();
		const compressionGeneration = compression?.cache.getPathGeneration(staticResult.filePath) ?? 0;
		const compressionFileVersion = compression ? createCompressionFileVersion(fileStat) : void 0;
		const headers = applyDefaultSecurityHeaders(new Headers({
			"content-type": staticResult.contentType,
			"cache-control": staticResult.cacheControl,
			etag: createWeakEtag(fileStat),
			"last-modified": fileStat.mtime.toUTCString()
		}));
		applyHeadersManifest(headers, headersManifest, pathname);
		const encoding = negotiateFileEncoding(request, headers, fileStat.size, compression);
		if (isNotModified(request, headers, compressionGeneration === 0)) {
			res.statusCode = 304;
			writeNodeHeaders(res, headers);
			res.end();
			return;
		}
		res.statusCode = 200;
		writeNodeHeaders(res, headers);
		if (request.method === "HEAD") {
			await writeFileHead(res, staticResult.filePath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration);
			return;
		}
		await writeFileBody(res, staticResult.filePath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration);
	} finally {
		await file.close();
	}
}
/**
* Decide the on-the-wire encoding for a file response and stamp the
* compression headers. Mutates `headers` before the conditional-request check
* so the `ETag` the client revalidates against always names the encoded
* variant it was served — encoded and identity variants never share a
* validator.
*/
function negotiateFileEncoding(request, headers, fileSize, compression) {
	if (!compression) return null;
	const identityEtag = headers.get("etag");
	if (identityEtag) headers.set("etag", protectIdentityEtag(identityEtag));
	if (!isCompressibleContentType(headers.get("content-type")) || !isTransformableResponse(200, headers)) return null;
	headers.set("vary", mergeVaryValue(headers.get("vary")));
	if (request.headers.has("range")) return null;
	if (fileSize < 1024) return null;
	const encoding = negotiateEncoding(compression.request.headers.get("accept-encoding"));
	if (!encoding) return null;
	headers.set("content-encoding", encoding);
	headers.delete("content-length");
	if (identityEtag) headers.set("etag", encodeEtagForEncoding(identityEtag, encoding));
	return encoding;
}
/**
* Stream a file body, compressed when an encoding was negotiated. Files up to
* `MAX_CACHEABLE_ASSET_SIZE` are compressed once at high quality and served
* from an in-memory LRU keyed by path + durable file identity + local write
* generation, so hashed assets and (re)generated ISG documents pay the
* compression cost once per version. The open handle binds the bytes to the
* metadata and validator selected by the caller even if the path is replaced
* concurrently. Larger files stream through zlib per request.
*/
async function writeFileBody(res, filePath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration) {
	if (!encoding || !compression || !compressionFileVersion) {
		await pipeToResponse(file.createReadStream({ autoClose: false }), res);
		return;
	}
	const pending = getBufferedCompressedFile(filePath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration);
	if (pending) {
		const compressed = await pending;
		res.setHeader("content-length", compressed.byteLength);
		res.end(compressed);
		return;
	}
	await pipeToResponse(createCompressedStream(file.createReadStream({ autoClose: false }), encoding, { sizeHint: fileStat.size }), res);
}
function getBufferedCompressedFile(filePath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration) {
	if (fileStat.size > 1048576) return null;
	const key = `${filePath}\0${compressionFileVersion}\0${compressionGeneration}\0${encoding}`;
	return compression.cache.getOrCompress(key, fileStat.size, async () => compressBuffer(await file.readFile(), encoding));
}
async function writeFileHead(res, filePath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration) {
	const pending = encoding && compression && compressionFileVersion ? getBufferedCompressedFile(filePath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration) : null;
	if (pending) {
		const compressed = await pending;
		res.setHeader("content-length", compressed.byteLength);
	}
	res.end();
}
async function serveISGEntry(request, res, options, staticDir, pathname, entry, headersManifest, contextArgs, compression) {
	const htmlPath = resolveContainedPath(staticDir, pathname);
	if (!htmlPath) return false;
	const file = await open(htmlPath, "r").catch(() => null);
	if (!file) return false;
	try {
		const fileStat = await file.stat();
		if (!fileStat.isFile()) return false;
		const compressionGeneration = compression?.cache.getPathGeneration(htmlPath) ?? 0;
		const compressionFileVersion = compression ? createCompressionFileVersion(fileStat) : void 0;
		const ageMs = Date.now() - fileStat.mtimeMs;
		const revalidateSeconds = getTimeRevalidateSeconds(entry.revalidate);
		const isStale = revalidateSeconds !== null && ageMs > revalidateSeconds * 1e3;
		const headers = applyDefaultSecurityHeaders(new Headers({
			"content-type": "text/html; charset=utf-8",
			"cache-control": "public, max-age=0, must-revalidate",
			etag: createWeakEtag(fileStat),
			"last-modified": fileStat.mtime.toUTCString(),
			vary: ROUTE_STATE_REQUEST_HEADER
		}));
		applyHeadersManifest(headers, headersManifest, pathname);
		await applyCompressionContentValidator(headers, htmlPath, file, fileStat.size, compressionFileVersion, compressionGeneration, compression);
		headers.set("x-pracht-isg", isStale ? "stale" : "fresh");
		const encoding = negotiateFileEncoding(request, headers, fileStat.size, compression);
		if (isNotModified(request, headers, compression === void 0)) {
			res.statusCode = 304;
			writeNodeHeaders(res, headers);
			res.end();
		} else {
			res.statusCode = 200;
			writeNodeHeaders(res, headers);
			if (request.method === "HEAD") await writeFileHead(res, htmlPath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration);
			else await writeFileBody(res, htmlPath, file, fileStat, encoding, compression, compressionFileVersion, compressionGeneration);
		}
		if (isStale) regenerateISGPageAndInvalidateCache(options, pathname, htmlPath, contextArgs, compression).catch((err) => {
			console.error(`ISG regeneration failed for ${pathname}:`, err);
		});
		return true;
	} finally {
		await file.close();
	}
}
async function handleRevalidationEndpoint(request, options, staticDir, isgManifest, contextArgs, compression) {
	const parsed = await readRevalidationRequest(request, resolveRevalidationToken());
	if (!parsed.ok) return parsed.response;
	if (!staticDir) {
		const unavailable = new RevalidationReport();
		for (const pathname of parsed.paths) unavailable.skipped(pathname, "not_prerendered");
		return jsonResponse({
			error: "ISG revalidation requires a staticDir.",
			...unavailable.toJSON()
		}, 503);
	}
	const report = new RevalidationReport();
	for (const pathname of parsed.paths) try {
		const entry = isgManifest[pathname];
		const htmlPath = resolveContainedPath(staticDir, pathname);
		const skip = classifyRevalidationSkip(entry && {
			render: "isg",
			revalidate: entry.revalidate
		}, htmlPath !== null, matchAppRoute(options.app, pathname)?.route ?? null);
		if (skip) {
			report.skipped(pathname, skip);
			continue;
		}
		if (await regenerateISGPageAndInvalidateCache(options, pathname, htmlPath, contextArgs, compression)) report.revalidated(pathname);
		else report.failed(pathname, "regeneration_failed");
	} catch (err) {
		console.error(`ISG webhook revalidation failed for ${pathname}:`, err);
		report.failed(pathname, "regeneration_error");
	}
	return jsonResponse(report.toJSON());
}
async function regenerateISGPageAndInvalidateCache(options, pathname, htmlPath, contextArgs, compression) {
	const regenerated = await regenerateISGPage(options, pathname, htmlPath, contextArgs);
	if (regenerated) compression?.cache.invalidatePath(htmlPath);
	return regenerated;
}
/**
* Resolve a URL pathname to `<staticDir>/<pathname>/index.html` while
* ensuring the result stays inside `staticDir`. Returns `null` when the
* pathname would escape the root (`..`, encoded separators, NUL bytes,
* etc.), which the caller treats as a miss. Also rejects NUL — Node
* filesystem APIs throw on these but it's clearer to bail early.
*/
function resolveContainedPath(staticDir, pathname) {
	if (pathname.includes("\0")) return null;
	const rootResolved = resolve(staticDir);
	const resolved = resolve(pathname === "/" ? join(rootResolved, "index.html") : resolve(rootResolved, `.${pathname}`, "index.html"));
	if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) return null;
	return resolved;
}
function isRouteStateRequest(url, headers) {
	return headers.get(ROUTE_STATE_REQUEST_HEADER) === "1" || url.searchParams.get("_data") === "1";
}
/**
* Dynamic compression owns conditional validation after it has selected the
* outgoing representation and escaped its reserved validator namespace. Do
* not let an application short-circuit against the source identity metadata
* before either step happens.
*/
function createApplicationRequest(request, compression) {
	const ifMatch = request.headers.get("if-match");
	const ifNoneMatch = request.headers.get("if-none-match");
	if (!compression || request.method !== "GET" && request.method !== "HEAD" || request.headers.has("range") || !ifMatch && !ifNoneMatch && !request.headers.has("if-modified-since") || !negotiateEncoding(request.headers.get("accept-encoding")) && !containsEncodedEtag(ifMatch) && !containsEncodedEtag(ifNoneMatch)) return request;
	const headers = new Headers(request.headers);
	if (ifMatch) {
		compression.ownsIfMatch = true;
		headers.delete("if-match");
		headers.delete("if-unmodified-since");
	}
	headers.delete("if-none-match");
	headers.delete("if-modified-since");
	return new Request(request, { headers });
}
function isStaticAssetMethod(method) {
	return method === "GET" || method === "HEAD";
}
function writeNodeHeaders(res, headers) {
	writeNodeResponseHeaders(res, headers);
}
function createWeakEtag(fileStat) {
	return `W/"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`;
}
async function applyCompressionContentValidator(headers, filePath, file, fileSize, compressionFileVersion, compressionGeneration, compression) {
	if (!compressionFileVersion || !compression) return;
	const key = `${filePath}\0${compressionFileVersion}\0${compressionGeneration}`;
	const pending = compression.cache.getOrCreateFileEtag(key, fileSize, () => createFileContentEtag(file));
	if (!pending) {
		headers.delete("etag");
		return;
	}
	headers.set("etag", await pending);
}
async function createFileContentEtag(file) {
	const hash = createHash("sha256");
	const buffer = Buffer.allocUnsafe(64 * 1024);
	let position = 0;
	while (true) {
		const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, position);
		if (bytesRead === 0) break;
		hash.update(buffer.subarray(0, bytesRead));
		position += bytesRead;
	}
	return `W/"pracht-file-${hash.digest("base64url")}"`;
}
function isNotModified(request, headers, allowLastModified = true) {
	return isNotModifiedRequest(request, headers.get("etag"), allowLastModified ? headers.get("last-modified") : null);
}
//#endregion
//#region src/node-entry.ts
function createNodeServerEntryModule(options = {}) {
	const canonicalOrigin = options.canonicalOrigin ?? null;
	const port = options.port ?? 3e3;
	return [
		"import { existsSync, readFileSync } from \"node:fs\";",
		"import { createServer } from \"node:http\";",
		"import { dirname, resolve } from \"node:path\";",
		"import { fileURLToPath, pathToFileURL } from \"node:url\";",
		"import { createNodeRequestHandler } from \"@pracht/adapter-node\";",
		options.createContextFrom ? `import { createContext as createPrachtContext } from ${JSON.stringify(options.createContextFrom)};` : "const createPrachtContext = undefined;",
		options.configureServerFrom ? `import { configureServer as configurePrachtServer } from ${JSON.stringify(options.configureServerFrom)};` : "const configurePrachtServer = undefined;",
		"",
		"const serverDir = dirname(fileURLToPath(import.meta.url));",
		"const staticDir = resolve(serverDir, \"../client\");",
		"const isgManifestPath = resolve(serverDir, \"isg-manifest.json\");",
		"const isgManifest = existsSync(isgManifestPath)",
		"  ? JSON.parse(readFileSync(isgManifestPath, \"utf-8\"))",
		"  : {};",
		"const headersManifestPath = resolve(serverDir, \"headers-manifest.json\");",
		"const headersManifest = existsSync(headersManifestPath)",
		"  ? JSON.parse(readFileSync(headersManifestPath, \"utf-8\"))",
		"  : {};",
		"const markdownManifestPath = resolve(serverDir, \"markdown-manifest.json\");",
		"const markdownManifest = existsSync(markdownManifestPath)",
		"  ? JSON.parse(readFileSync(markdownManifestPath, \"utf-8\"))",
		"  : undefined;",
		"",
		"export const handler = createNodeRequestHandler({",
		"  app: resolvedApp,",
		"  registry,",
		"  staticDir,",
		"  isgManifest,",
		"  headersManifest,",
		"  markdownManifest,",
		"  apiRoutes,",
		"  clientEntryUrl: clientEntryUrl ?? undefined,",
		"  islandsEntryUrl: islandsEntryUrl ?? undefined,",
		"  islandsBootstrapRequired,",
		"  cssManifest,",
		"  jsManifest,",
		`  canonicalOrigin: ${JSON.stringify(canonicalOrigin ?? void 0)},`,
		`  basePathStripped: ${JSON.stringify(options.basePathStripped ?? void 0)},`,
		"  createContext: createPrachtContext,",
		`  maxBodySize: ${JSON.stringify(options.maxBodySize ?? void 0)},`,
		`  compression: ${JSON.stringify(options.compression ?? void 0)},`,
		"});",
		"",
		"const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;",
		"if (entryHref && import.meta.url === entryHref) {",
		"  const server = createServer(handler);",
		"  if (configurePrachtServer) await configurePrachtServer(server);",
		`  const port = Number(process.env.PORT ?? ${port});`,
		"  server.listen(port, () => {",
		"    console.log(`pracht node server listening on http://localhost:${port}`);",
		"  });",
		"}",
		""
	].join("\n");
}
/**
* Create a pracht adapter for Node.js.
*
* ```ts
* import { nodeAdapter } from "@pracht/adapter-node";
* pracht({ adapter: nodeAdapter() })
* ```
*/
function nodeAdapter(options = {}) {
	return {
		id: "node",
		serverImports: "import { resolveApp, resolveApiRoutes } from \"@pracht/core/server\";",
		createServerEntryModule() {
			return createNodeServerEntryModule(options);
		}
	};
}
//#endregion
export { createNodeRequestHandler, createNodeServerEntryModule, getCacheControl, nodeAdapter, resolveStaticFile };
