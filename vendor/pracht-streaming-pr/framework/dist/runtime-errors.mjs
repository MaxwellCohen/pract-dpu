//#region src/runtime-errors.ts
function isPrachtHttpError(error) {
	return error instanceof Error && error.name === "PrachtHttpError" && "status" in error;
}
let warnedAboutProductionDebugErrors = false;
/**
* `debugErrors: true` opts into surfacing stack traces, module paths,
* and middleware names in error responses. That is great in dev and
* dangerous in production — a misconfigured deploy would leak internals
* to the public. When `NODE_ENV === "production"` we refuse to honor
* the flag and emit a single console warning so the misconfiguration
* is visible in logs.
*/
function shouldExposeServerErrors(options) {
	if (options.debugErrors !== true) return false;
	if ((typeof process !== "undefined" && process.env ? process.env.NODE_ENV : typeof globalThis !== "undefined" && globalThis.process ? globalThis.process?.env?.NODE_ENV : void 0) === "production") {
		if (!warnedAboutProductionDebugErrors) {
			warnedAboutProductionDebugErrors = true;
			console.warn("[pracht] debugErrors is ignored in production builds. Remove it to silence this warning.");
		}
		return false;
	}
	return true;
}
function createSerializedRouteError(message, status, options = {}) {
	return {
		message,
		name: options.name ?? "Error",
		status,
		...options.diagnostics ? { diagnostics: options.diagnostics } : {}
	};
}
function buildRuntimeDiagnostics(options) {
	const route = options.route;
	const routeId = route && "id" in route ? route.id : void 0;
	return {
		phase: options.phase,
		routeId,
		routePath: route?.path,
		routeFile: route?.file,
		loaderFile: options.loaderFile,
		shellFile: options.shellFile,
		middlewareFiles: options.middlewareFiles ? [...options.middlewareFiles] : [],
		status: options.status
	};
}
function normalizeRouteError(error, options) {
	if (isPrachtHttpError(error)) {
		const status = typeof error.status === "number" ? error.status : 500;
		if (status >= 400 && status < 500) return {
			message: error.message,
			name: error.name,
			status
		};
		if (options.exposeDetails) return {
			message: error.message || "Internal Server Error",
			name: error.name || "Error",
			status
		};
		return {
			message: "Internal Server Error",
			name: "Error",
			status
		};
	}
	if (error instanceof Error) {
		if (options.exposeDetails) return {
			message: error.message || "Internal Server Error",
			name: error.name || "Error",
			status: 500
		};
		return {
			message: "Internal Server Error",
			name: "Error",
			status: 500
		};
	}
	if (options.exposeDetails) return {
		message: typeof error === "string" && error ? error : "Internal Server Error",
		name: "Error",
		status: 500
	};
	return {
		message: "Internal Server Error",
		name: "Error",
		status: 500
	};
}
function deserializeRouteError(error) {
	const result = new Error(error.message);
	result.name = error.name;
	result.status = error.status;
	result.diagnostics = error.diagnostics;
	return result;
}
//#endregion
export { buildRuntimeDiagnostics, createSerializedRouteError, deserializeRouteError, isPrachtHttpError, normalizeRouteError, shouldExposeServerErrors };
