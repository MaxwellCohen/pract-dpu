//#region src/event-source-hook.d.ts
type EventSourceStatus = "connecting" | "open" | "closed";
interface UseEventSourceOptions {
  /**
   * Named SSE event to listen for (the server's `event:` field). Defaults to
   * unnamed messages (`"message"`).
   */
  event?: string;
  /** `JSON.parse` incoming data. Malformed payloads are dropped with a warning. */
  json?: boolean;
  /** Send cookies on cross-origin connections (the `EventSource` option). */
  withCredentials?: boolean;
}
interface EventSourceState<T> {
  /** The most recent message payload, or `undefined` before the first one. */
  data: T | undefined;
  /**
   * `"connecting"` while the browser establishes (or re-establishes — the
   * browser reconnects automatically) the connection, `"open"` while it is
   * live, `"closed"` when it gave up, was disabled with a `null` URL, or is
   * rendering on the server.
   */
  status: EventSourceStatus;
  /** The `lastEventId` of the most recent message (the server's `id:` field). */
  lastEventId: string | undefined;
}
/**
 * Subscribe to a Server-Sent Events endpoint (see `createEventStream` on the
 * server side). The connection opens on mount and closes automatically on
 * unmount or when `url`/options change; a changed subscription starts clean
 * (`data`/`lastEventId` reset) so one endpoint's payload is never shown as
 * another's. Each hook instance opens its own connection — remember browsers
 * cap concurrent HTTP/1.1 connections per origin (6 in practice), so share
 * one subscription via context/props rather than mounting many for one URL.
 * Pass `null` to stay disconnected —
 * useful to gate the subscription on user state. During SSR it renders as
 * `{ status: "connecting" }` (or `"closed"` for a `null` URL) and never
 * connects.
 *
 * ```tsx
 * const { data, status } = useEventSource<{ now: number }>("/api/live", { json: true });
 * ```
 */
declare function useEventSource<T = string>(url: string | URL | null | undefined, options?: UseEventSourceOptions): EventSourceState<T>;
//#endregion
export { EventSourceState, EventSourceStatus, UseEventSourceOptions, useEventSource };