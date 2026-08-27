import { applyHeaders } from "./runtime-headers.mjs";
//#region src/event-stream.ts
/**
* Matches every line break the SSE parser recognizes (CRLF, CR, LF), so a
* multi-line payload round-trips: the client's EventSource joins consecutive
* `data:` lines with `\n`.
*/
const SSE_LINE_BREAK_RE = /\r\n|\r|\n/;
function assertSafeSseField(field, value) {
	if (/[\r\n]/.test(value) || field === "id" && value.includes("\0")) throw new Error(`Refused to serialize SSE "${field}" field containing CR, LF, or NUL`);
}
/**
* Serialize one message into its SSE wire format. Exported for tests and for
* code that manages its own stream but wants the framing exactly right.
*/
function serializeEventStreamMessage(message) {
	let out = "";
	if (message.event !== void 0) {
		assertSafeSseField("event", message.event);
		out += `event: ${message.event}\n`;
	}
	if (message.id !== void 0) {
		assertSafeSseField("id", message.id);
		out += `id: ${message.id}\n`;
	}
	if (message.retry !== void 0) {
		if (!Number.isInteger(message.retry) || message.retry < 0) throw new Error(`SSE "retry" must be a non-negative integer of milliseconds`);
		out += `retry: ${message.retry}\n`;
	}
	const text = typeof message.data === "string" ? message.data : JSON.stringify(message.data) ?? "";
	for (const line of text.split(SSE_LINE_BREAK_RE)) out += `data: ${line}\n`;
	return `${out}\n`;
}
/**
* Create a Server-Sent Events stream for an API route handler.
*
* ```ts
* export function GET({ request }: BaseRouteArgs) {
*   const stream = createEventStream(request, { keepAlive: 15 });
*   const timer = setInterval(() => {
*     if (!stream.send({ data: { now: Date.now() } })) clearInterval(timer);
*   }, 1000);
*   return stream.response;
* }
* ```
*
* Built on the web `ReadableStream`, so it behaves identically on Node,
* Cloudflare Workers, and Vercel Edge. Cleanup is wired to both disconnect
* signals a runtime can deliver: `request.signal` aborting (workerd, edge)
* and the response stream being cancelled (the Node adapter destroys the
* piped stream when the client hangs up). Either one closes the stream,
* clears the keep-alive timer, and makes `send()` return `false`.
*
* The response carries `Cache-Control: no-store, no-transform` so shared
* caches never buffer or store it and compression/transforming proxies leave
* the framing alone, plus `X-Accel-Buffering: no` for nginx-style reverse
* proxies that buffer streamed responses by default.
*/
function createEventStream(request, init = {}) {
	if (init.keepAlive !== void 0 && !(Number.isFinite(init.keepAlive) && init.keepAlive > 0)) throw new Error(`createEventStream keepAlive must be a positive number of seconds`);
	const headers = new Headers({
		"cache-control": "no-store, no-transform",
		"content-type": "text/event-stream; charset=utf-8",
		"x-accel-buffering": "no"
	});
	if (init.headers) applyHeaders(headers, init.headers);
	const encoder = new TextEncoder();
	let controller = null;
	let heartbeat;
	let closed = false;
	function markClosed() {
		if (closed) return;
		closed = true;
		if (heartbeat !== void 0) {
			clearInterval(heartbeat);
			heartbeat = void 0;
		}
		request.signal.removeEventListener("abort", onAbort);
	}
	function close() {
		if (closed) return;
		markClosed();
		try {
			controller?.close();
		} catch {}
	}
	function onAbort() {
		close();
	}
	function enqueue(text) {
		if (closed || controller === null) return false;
		try {
			controller.enqueue(encoder.encode(text));
			return true;
		} catch {
			markClosed();
			return false;
		}
	}
	const stream = new ReadableStream({
		start(c) {
			controller = c;
		},
		cancel() {
			markClosed();
		}
	});
	if (init.keepAlive !== void 0 && !request.signal.aborted) {
		heartbeat = setInterval(() => {
			enqueue(":keep-alive\n\n");
		}, init.keepAlive * 1e3);
		heartbeat.unref?.();
	}
	if (request.signal.aborted) close();
	else request.signal.addEventListener("abort", onAbort, { once: true });
	return {
		response: new Response(stream, {
			headers,
			status: 200
		}),
		send(message) {
			return enqueue(serializeEventStreamMessage(message));
		},
		close,
		get closed() {
			return closed;
		},
		get desiredSize() {
			if (closed || controller === null) return null;
			try {
				return controller.desiredSize;
			} catch {
				return null;
			}
		}
	};
}
//#endregion
export { createEventStream, serializeEventStreamMessage };
