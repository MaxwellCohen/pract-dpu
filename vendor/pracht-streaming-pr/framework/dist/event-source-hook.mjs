import { useEffect, useState } from "preact/hooks";
//#region src/event-source-hook.ts
function sameSubscription(left, right) {
	return left.href === right.href && left.event === right.event && left.json === right.json && left.withCredentials === right.withCredentials;
}
function emptyState(status) {
	return {
		data: void 0,
		lastEventId: void 0,
		status
	};
}
/** `EventSource.CLOSED` — inlined so mocks without the constant still work. */
const CLOSED_READY_STATE = 2;
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
function useEventSource(url, options = {}) {
	const { event = "message", json = false, withCredentials = false } = options;
	const href = url == null ? null : String(url);
	const subscription = {
		event,
		href,
		json,
		withCredentials
	};
	const [current, setCurrent] = useState({
		state: emptyState(href == null ? "closed" : "connecting"),
		subscription
	});
	const state = sameSubscription(current.subscription, subscription) ? current.state : emptyState(href == null ? "closed" : "connecting");
	useEffect(() => {
		if (href == null || typeof EventSource === "undefined") {
			setCurrent((previous) => sameSubscription(previous.subscription, subscription) && previous.state.status === "closed" && previous.state.data === void 0 && previous.state.lastEventId === void 0 ? previous : {
				state: emptyState("closed"),
				subscription
			});
			return;
		}
		setCurrent((previous) => sameSubscription(previous.subscription, subscription) && previous.state.status === "connecting" && previous.state.data === void 0 && previous.state.lastEventId === void 0 ? previous : {
			state: emptyState("connecting"),
			subscription
		});
		const source = new EventSource(href, { withCredentials });
		const onOpen = () => {
			setCurrent((previous) => sameSubscription(previous.subscription, subscription) ? {
				...previous,
				state: {
					...previous.state,
					status: "open"
				}
			} : previous);
		};
		const onError = () => {
			const status = source.readyState === CLOSED_READY_STATE ? "closed" : "connecting";
			setCurrent((previous) => {
				if (!sameSubscription(previous.subscription, subscription)) return previous;
				return previous.state.status === status ? previous : {
					...previous,
					state: {
						...previous.state,
						status
					}
				};
			});
		};
		const onMessage = (messageEvent) => {
			let data;
			if (json) try {
				data = JSON.parse(messageEvent.data);
			} catch {
				console.warn(`[pracht] useEventSource(${href}): dropped non-JSON message`);
				return;
			}
			else data = messageEvent.data;
			setCurrent((previous) => sameSubscription(previous.subscription, subscription) ? {
				...previous,
				state: {
					...previous.state,
					data,
					lastEventId: messageEvent.lastEventId || void 0
				}
			} : previous);
		};
		source.addEventListener("open", onOpen);
		source.addEventListener("error", onError);
		source.addEventListener(event, onMessage);
		return () => {
			source.removeEventListener("open", onOpen);
			source.removeEventListener("error", onError);
			source.removeEventListener(event, onMessage);
			source.close();
		};
	}, [
		href,
		event,
		json,
		withCredentials
	]);
	return state;
}
//#endregion
export { useEventSource };
