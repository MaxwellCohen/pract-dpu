import { useCallback, useEffect, useRef, useState } from "preact/hooks";
//#region src/capability-hook.ts
/**
* `useCapability()` — call state for user-triggered capability calls.
*
* Deliberately *not* a fetch-on-render hook. Pracht's data model is
* server-owned: loaders run on the server, `useRouteData()` reads their result
* out of the SSR payload, and a successful non-`read` capability call already
* revalidates that data through the effect class. Fetching during render would
* add a client-side waterfall and render nothing during SSR — for data a page
* needs, `loader` + `invokeCapability()` is both simpler and faster.
*
* What that leaves uncovered is the *interaction*: a button click, a search
* box, a picker. `<Form capability>` already handles the form case; everything
* else meant hand-rolling pending/error/result state around `callCapability`.
* This hook is that state, nothing more.
*
* The dispatch function is injected rather than imported so the implementation
* can live here (typed, unit-testable) while the app-specific endpoint table
* stays in the generated `virtual:pracht/capabilities` module. One dispatch
* path means the settled event, effect-driven revalidation, and custom
* `expose.http.path` values behave identically however a capability is called.
*/
const IDLE = {
	data: void 0,
	error: void 0,
	pending: false
};
/**
* Build a `useCapability` hook bound to a dispatch function. The generated
* `virtual:pracht/capabilities` module calls this with its `callCapability`;
* applications import the resulting hook, not this factory.
*/
function createUseCapability(dispatch) {
	return function useCapability(name) {
		const activeName = useRef(name);
		const nameGeneration = useRef(0);
		const latestCallId = useRef(0);
		if (activeName.current !== name) {
			activeName.current = name;
			nameGeneration.current += 1;
			latestCallId.current += 1;
		}
		const generation = nameGeneration.current;
		const [state, setState] = useState({
			...IDLE,
			generation
		});
		const current = state.generation === generation ? state : {
			...IDLE,
			generation
		};
		const mounted = useRef(true);
		useEffect(() => {
			mounted.current = true;
			return () => {
				mounted.current = false;
			};
		}, []);
		const call = useCallback(async (...args) => {
			const isCurrentGeneration = () => activeName.current === name && nameGeneration.current === generation;
			const stale = !isCurrentGeneration();
			const callId = stale ? -1 : ++latestCallId.current;
			const isCurrent = () => !stale && mounted.current && callId === latestCallId.current && isCurrentGeneration();
			if (isCurrent()) setState((previous) => ({
				...previous.generation === generation ? previous : IDLE,
				error: void 0,
				generation,
				pending: true
			}));
			let envelope;
			try {
				const dispatched = await dispatch(name, ...args);
				const record = dispatched;
				const error = record?.error;
				if (!record || record.ok !== true && record.ok !== false || record.ok === true && !("data" in record) || record.ok === false && (!error || typeof error.code !== "string" || typeof error.message !== "string")) throw new TypeError("Capability dispatcher returned an invalid envelope.");
				envelope = dispatched;
			} catch (error) {
				if (isCurrent()) setState((previous) => ({
					...previous,
					pending: false
				}));
				throw error;
			}
			if (isCurrent()) setState((previous) => envelope.ok ? {
				data: envelope.data,
				error: void 0,
				generation,
				pending: false
			} : {
				data: previous.generation === generation ? previous.data : void 0,
				error: envelope.error,
				generation,
				pending: false
			});
			return envelope;
		}, [generation, name]);
		const reset = useCallback(() => {
			if (activeName.current !== name || nameGeneration.current !== generation) return;
			latestCallId.current += 1;
			setState({
				...IDLE,
				generation
			});
		}, [generation, name]);
		const { generation: _stateGeneration, ...visible } = current;
		return {
			...visible,
			call,
			reset
		};
	};
}
//#endregion
export { createUseCapability };
