import { formatUnknownNameError } from "./name-suggestions.mjs";
import { bindAgentContext } from "./runtime-agent-context.mjs";
import { handleCapabilityRequest, invokeCapabilityOnHost, resolveAppCapabilities } from "./runtime-capabilities.mjs";
//#region src/testing-capabilities.ts
const TEST_ORIGIN = "http://capability-test.local";
function createCapabilityTestHost(options) {
	const capabilityFiles = {};
	const capabilityModules = {};
	for (const [name, capability] of Object.entries(options.capabilities)) {
		const file = `test:capability:${name}`;
		capabilityFiles[name] = file;
		capabilityModules[file] = async () => ({ default: capability });
	}
	const middlewareFiles = {};
	const middlewareModules = {};
	for (const [name, middleware] of Object.entries(options.middleware ?? {})) {
		const file = `test:middleware:${name}`;
		middlewareFiles[name] = file;
		middlewareModules[file] = async () => ({ middleware });
	}
	const host = {
		app: {
			capabilities: capabilityFiles,
			middleware: middlewareFiles
		},
		registry: {
			capabilityModules,
			middlewareModules
		}
	};
	return {
		invoke(name, input, invokeOptions = {}) {
			return invokeCapabilityOnHost(host, name, input, {
				request: invokeOptions.request ?? new Request(`${TEST_ORIGIN}/`),
				context: invokeOptions.context ?? {},
				signal: invokeOptions.signal
			});
		},
		async request(name, input, requestOptions = {}) {
			const capabilities = await resolveAppCapabilities(host.app, host.registry);
			const match = capabilities.find((entry) => entry.name === name);
			if (!match?.httpPath) return Response.json({
				ok: false,
				error: {
					code: "unknown_capability",
					message: formatUnknownNameError({
						kind: "capability",
						kindPlural: "capabilities",
						name,
						registered: capabilities.filter((entry) => entry.httpPath).map((entry) => entry.name)
					})
				}
			}, { status: 404 });
			let agent = requestOptions.agent ?? null;
			let context = { ...requestOptions.context };
			if (options.agents?.webBotAuth || requestOptions.agent !== void 0) {
				const boundContext = bindAgentContext(context, agent);
				context = boundContext;
				agent = boundContext.agent ?? null;
			}
			const headers = new Headers(requestOptions.headers);
			if (!headers.has("content-type")) headers.set("content-type", "application/json");
			const request = new Request(`${TEST_ORIGIN}${match.httpPath}`, {
				method: "POST",
				headers,
				body: JSON.stringify(input === void 0 ? {} : input)
			});
			return handleCapabilityRequest({
				match,
				context,
				registry: host.registry,
				request,
				url: new URL(request.url),
				pathname: match.httpPath,
				exposeErrors: true,
				agents: options.agents,
				agent
			});
		}
	};
}
//#endregion
export { createCapabilityTestHost };
