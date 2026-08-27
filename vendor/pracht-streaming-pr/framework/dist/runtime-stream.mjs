import { applyHeaders, applySecurityAndRouteHeaders } from "./runtime-headers.mjs";
import { normalizeRouteError } from "./runtime-errors.mjs";
import { escapeHtml, escapeScriptText } from "./runtime-html.mjs";
import { getRenderToReadableStream } from "./runtime-response.mjs";
//#region src/runtime-stream.ts
const streamingResponseBodies = /* @__PURE__ */ new WeakSet();
/** Whether a response body was created by Pracht's streaming document renderer. */
function isStreamingHtmlResponse(response) {
	return response.body !== null && streamingResponseBodies.has(response.body);
}
/**
* Render `tree` into a streaming `text/html` response.
*
* Status and headers are committed with the first chunk. A failure before that
* point still throws, so the caller can fall back to a normal error document;
* after it, the stream is errored and `onError` is called.
*/
async function streamingHtmlResponse(options) {
	const { tree, prefix, afterShell, suffix, status = 200, signal, onError, onCancel, pending = [], nonce, exposeErrorDetails = false } = options;
	const renderToReadableStream = await getRenderToReadableStream();
	const encoder = new TextEncoder();
	const rendered = renderToReadableStream(tree);
	rendered.allReady.catch(() => {});
	const reader = rendered.getReader();
	let firstRead;
	try {
		firstRead = await reader.read();
	} catch (error) {
		reader.releaseLock();
		throw error;
	}
	let closed = false;
	let openDeferChannel;
	const deferChannelReady = pending.length === 0 ? Promise.resolve() : new Promise((resolve) => {
		openDeferChannel = resolve;
	});
	let releaseDemand;
	const wakeWriter = () => {
		const release = releaseDemand;
		releaseDemand = void 0;
		release?.();
	};
	const body = new ReadableStream({
		start(controller) {
			let writeTail = Promise.resolve();
			const writeChunk = (createChunk) => {
				const write = writeTail.then(async () => {
					if (closed) return;
					if ((controller.desiredSize ?? 0) <= 0) await new Promise((resolve) => {
						releaseDemand = resolve;
					});
					if (closed) return;
					controller.enqueue(createChunk());
				});
				writeTail = write.catch(() => {});
				return write;
			};
			const write = (text) => writeChunk(() => encoder.encode(typeof text === "function" ? text() : text));
			const abort = () => {
				if (closed) return;
				closed = true;
				openDeferChannel?.();
				wakeWriter();
				controller.error(signal?.reason ?? new DOMException("The streaming render was aborted."));
			};
			if (signal) if (signal.aborted) {
				closed = true;
				openDeferChannel?.();
				controller.error(signal.reason ?? new DOMException("The streaming render was aborted."));
			} else signal.addEventListener("abort", abort, { once: true });
			const scriptOpen = `<script${nonce ? ` nonce="${escapeHtml(nonce)}"` : ""}>`;
			const writeDeferred = async (script) => {
				await deferChannelReady;
				await write(script);
			};
			const deferredWrites = pending.map(({ id, promise }) => promise.then(async (value) => {
				await writeDeferred(() => `${scriptOpen}window.__PRACHT_DEFER__.r(${escapeScriptText(JSON.stringify(id))},${escapeScriptText(JSON.stringify(value) ?? "null")})<\/script>`);
			}, async (error) => {
				await writeDeferred(() => {
					const serializedError = normalizeRouteError(error, { exposeDetails: exposeErrorDetails });
					return `${scriptOpen}window.__PRACHT_DEFER__.e(${escapeScriptText(JSON.stringify(id))},${escapeScriptText(JSON.stringify(serializedError))})<\/script>`;
				});
			}));
			(async () => {
				try {
					await write(prefix);
					let takeFirstChunk = true;
					if (!firstRead.done) {
						await writeChunk(() => firstRead.value);
						takeFirstChunk = false;
						await write(afterShell);
						openDeferChannel?.();
					}
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						if (closed) break;
						await writeChunk(() => value);
					}
					if (closed) {
						for (;;) {
							const { done } = await reader.read();
							if (done) break;
						}
						return;
					}
					if (takeFirstChunk) {
						await write(afterShell);
						openDeferChannel?.();
					}
					await Promise.all(deferredWrites);
					await write(suffix);
					if (closed) return;
					closed = true;
					controller.close();
				} catch (error) {
					if (closed) return;
					closed = true;
					onError?.(error);
					controller.error(error);
				} finally {
					if (signal) signal.removeEventListener("abort", abort);
					reader.releaseLock();
				}
			})();
		},
		pull() {
			wakeWriter();
		},
		cancel() {
			closed = true;
			openDeferChannel?.();
			wakeWriter();
			onCancel?.();
		}
	});
	const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
	if (options.headers) applyHeaders(headers, options.headers);
	applySecurityAndRouteHeaders(headers, { isRouteStateRequest: false });
	headers.delete("content-length");
	streamingResponseBodies.add(body);
	return new Response(body, {
		status,
		headers
	});
}
//#endregion
export { isStreamingHtmlResponse, streamingHtmlResponse };
