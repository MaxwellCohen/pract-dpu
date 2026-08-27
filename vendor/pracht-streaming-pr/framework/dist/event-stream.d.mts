//#region src/event-stream.d.ts
/**
 * One Server-Sent Events message. `data` is the only required field: strings
 * are sent as-is (multi-line values become one `data:` line per line, exactly
 * as the SSE wire format requires), anything else is `JSON.stringify`ed.
 */
interface EventStreamMessage {
  /** Payload. Strings pass through; other values are JSON-serialized. */
  data: unknown;
  /** Optional event name, dispatched to `addEventListener(event)` listeners. */
  event?: string;
  /** Optional event id, exposed as `lastEventId` and replayed by browsers in `Last-Event-ID`. */
  id?: string;
  /** Optional reconnection delay hint in milliseconds. */
  retry?: number;
}
interface EventStreamInit {
  /**
   * Emit a comment line (`:keep-alive`) every `keepAlive` seconds so proxies
   * and load balancers with idle timeouts keep the connection open. Off when
   * omitted. The timer is cleared as soon as the stream closes or the client
   * disconnects.
   */
  keepAlive?: number;
  /** Extra headers merged over the SSE defaults. */
  headers?: HeadersInit;
}
interface EventStream {
  /** The streaming `Response` to return from the API route handler. */
  response: Response;
  /**
   * Serialize and enqueue one message. Returns `false` — instead of throwing —
   * once the stream is closed or the client has disconnected, so producer
   * loops can use the return value as their stop condition.
   */
  send(message: EventStreamMessage): boolean;
  /** End the stream. Idempotent; also clears the keep-alive timer. */
  close(): void;
  /** True once the stream closed or the client disconnected. */
  readonly closed: boolean;
  /**
   * Remaining capacity in the response stream's internal queue, straight from
   * `ReadableStreamDefaultController.desiredSize`: positive while the consumer
   * keeps up, zero or negative once sent messages sit unread (each unread
   * message lowers it by one), `null` after the stream closed. `send()` never
   * applies backpressure — a stalled consumer buffers without bound — so a
   * producer pushing serious volume should check this and pause or drop when
   * it goes negative.
   */
  readonly desiredSize: number | null;
}
/**
 * Serialize one message into its SSE wire format. Exported for tests and for
 * code that manages its own stream but wants the framing exactly right.
 */
declare function serializeEventStreamMessage(message: EventStreamMessage): string;
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
declare function createEventStream(request: Request, init?: EventStreamInit): EventStream;
//#endregion
export { EventStream, EventStreamInit, EventStreamMessage, createEventStream, serializeEventStreamMessage };