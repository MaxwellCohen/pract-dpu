//#region src/constraints.ts
/** Every route matching `pattern` must include all of the given middleware names. */
function requireMiddleware(pattern, ...middleware) {
	assertValidPattern(pattern);
	assertNonEmpty(middleware, "requireMiddleware", "middleware name");
	return {
		kind: "require-middleware",
		pattern,
		middleware
	};
}
/** Every route matching `pattern` must use one of the given shells. */
function requireShell(pattern, ...shells) {
	assertValidPattern(pattern);
	assertNonEmpty(shells, "requireShell", "shell name");
	return {
		kind: "require-shell",
		pattern,
		shells
	};
}
/** Every route matching `pattern` must use one of the given render modes. */
function requireRenderMode(pattern, ...modes) {
	assertValidPattern(pattern);
	assertNonEmpty(modes, "requireRenderMode", "render mode");
	return {
		kind: "require-render-mode",
		pattern,
		modes
	};
}
/** No route matching `pattern` may use any of the given render modes. */
function forbidRenderMode(pattern, ...modes) {
	assertValidPattern(pattern);
	assertNonEmpty(modes, "forbidRenderMode", "render mode");
	return {
		kind: "forbid-render-mode",
		pattern,
		modes
	};
}
/** Every route matching `pattern` must export `head()` (directly or via its shell). */
function requireHead(pattern) {
	assertValidPattern(pattern);
	return {
		kind: "require-head",
		pattern
	};
}
/**
* Match a route path against a constraint pattern. Segment-wise: `*` matches
* exactly one segment, a trailing `**` matches zero or more segments, other
* segments compare literally against the declared path (so `/blog/*` matches
* `/blog/:slug`).
*/
function matchRoutePattern(pattern, routePath) {
	const patternSegments = splitSegments(pattern);
	const pathSegments = splitSegments(routePath);
	for (let index = 0; index < patternSegments.length; index += 1) {
		const patternSegment = patternSegments[index];
		if (patternSegment === "**") {
			if (index !== patternSegments.length - 1) throw new Error(`Invalid constraint pattern ${JSON.stringify(pattern)}: "**" is only supported as the final segment.`);
			return true;
		}
		const pathSegment = pathSegments[index];
		if (pathSegment === void 0) return false;
		if (patternSegment === "*") continue;
		if (patternSegment !== pathSegment) return false;
	}
	return patternSegments.length === pathSegments.length;
}
function evaluateConstraints(routes, constraints, options = {}) {
	const violations = [];
	for (const constraint of constraints) for (const route of routes) {
		if (!matchRoutePattern(constraint.pattern, route.path)) continue;
		const message = evaluateConstraintForRoute(constraint, route, options);
		if (message) violations.push({
			constraint,
			message,
			routePath: route.path
		});
	}
	return violations;
}
function evaluateConstraintForRoute(constraint, route, options) {
	switch (constraint.kind) {
		case "require-middleware": {
			const missing = constraint.middleware.filter((name) => !route.middleware.includes(name));
			if (missing.length === 0) return null;
			return `Route "${route.path}" is missing required middleware ${missing.map((name) => JSON.stringify(name)).join(", ")} (constraint pattern ${JSON.stringify(constraint.pattern)}).`;
		}
		case "require-shell": {
			const shell = route.shell ?? null;
			if (shell !== null && constraint.shells.includes(shell)) return null;
			return `Route "${route.path}" uses shell ${shell === null ? "none" : JSON.stringify(shell)} but must use ${formatOneOf(constraint.shells)} (constraint pattern ${JSON.stringify(constraint.pattern)}).`;
		}
		case "require-render-mode": {
			const render = route.render ?? null;
			if (render !== null && constraint.modes.includes(render)) return null;
			return `Route "${route.path}" renders as ${render === null ? "the default mode" : JSON.stringify(render)} but must use ${formatOneOf(constraint.modes)} (constraint pattern ${JSON.stringify(constraint.pattern)}).`;
		}
		case "forbid-render-mode": {
			const render = route.render ?? null;
			if (render === null || !constraint.modes.includes(render)) return null;
			return `Route "${route.path}" renders as ${JSON.stringify(render)}, which is forbidden here (constraint pattern ${JSON.stringify(constraint.pattern)}).`;
		}
		case "require-head":
			if (options.routeHasHead?.(route) !== false) return null;
			return `Route "${route.path}" does not export head() and neither does its shell (constraint pattern ${JSON.stringify(constraint.pattern)}).`;
	}
}
function formatOneOf(values) {
	if (values.length === 1) return JSON.stringify(values[0]);
	return `one of ${values.map((value) => JSON.stringify(value)).join(", ")}`;
}
function splitSegments(path) {
	return path.split("/").filter(Boolean);
}
function assertValidPattern(pattern) {
	if (typeof pattern !== "string" || pattern !== "**" && !pattern.startsWith("/")) throw new Error(`Invalid constraint pattern ${JSON.stringify(pattern)}: expected "**" or a route path pattern starting with "/".`);
}
function assertNonEmpty(values, helper, noun) {
	if (values.length === 0) throw new Error(`${helper}() expects at least one ${noun}.`);
}
//#endregion
export { evaluateConstraints, forbidRenderMode, matchRoutePattern, requireHead, requireMiddleware, requireRenderMode, requireShell };
