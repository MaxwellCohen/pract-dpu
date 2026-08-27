import { Component, Fragment, h } from "preact";
//#region src/error-boundary.ts
/**
* Catch render errors in a subtree without taking down the page.
*
* A route or shell that wants to handle *its own* failures exports
* `ErrorBoundary` instead; the runtime renders it with the route error. This
* component is for the smaller case — an embedded widget, a lazy island, a
* third-party integration — where only part of a working page should be
* replaced.
*
* ```jsx
* <ErrorBoundary fallback={(error, retry) => <Failed error={error} onRetry={retry} />}>
*   <Editor />
* </ErrorBoundary>
* ```
*
* Promises thrown for suspension pass straight through: this boundary declines
* them so `<Suspense>` still sees them. Without a `<Suspense>` ancestor the
* promise keeps propagating, exactly as it would without this boundary.
*/
var ErrorBoundary = class extends Component {
	state = { error: null };
	componentDidCatch(error) {
		if (isThenable(error)) throw error;
		const normalizedError = normalizeCaughtError(error);
		this.props.onError?.(normalizedError);
		this.setState({ error: normalizedError });
	}
	render(props, state) {
		if (state.error === null) return h(Fragment, null, props.children);
		const { fallback } = props;
		return h(Fragment, null, typeof fallback === "function" ? fallback(state.error, this.retry) : fallback);
	}
	retry = () => {
		this.setState({ error: null });
	};
};
function isThenable(value) {
	return typeof value?.then === "function";
}
function normalizeCaughtError(value) {
	if (value instanceof Error) return value;
	try {
		return new Error(String(value));
	} catch {
		return /* @__PURE__ */ new Error("Unknown error");
	}
}
//#endregion
export { ErrorBoundary, normalizeCaughtError };
