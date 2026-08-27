//#region src/prerender-module-hooks.ts
/**
* Node module hooks that stub `cloudflare:*` platform modules while
* `pracht build` imports the built server bundle for SSG prerendering.
*
* Edge server bundles keep platform-scheme imports external (they only exist
* inside workerd), so importing the bundle in Node would otherwise fail
* before the prerender pass can run. Nothing that touches these classes runs
* during prerendering — SSG only reads the resolved route manifest and
* renders page components.
*
* Registered from the build command via `module.register()`.
*/
const STUB_PREFIX = "pracht-cloudflare-stub:";
const STUB_SOURCES = {
	"cloudflare:workers": [
		"export class WorkerEntrypoint {}",
		"export class DurableObject {}",
		"export class WorkflowEntrypoint {}",
		"export class RpcTarget {}",
		"export const env = {};",
		"export const cache = { purge() { throw new Error(\"cache.purge is not available during prerendering\"); } };",
		""
	].join("\n"),
	"cloudflare:email": "export class EmailMessage {}\n",
	"cloudflare:sockets": "export function connect() { throw new Error(\"cloudflare:sockets is not available during prerendering\"); }\n"
};
function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith("cloudflare:")) {
		if (!(specifier in STUB_SOURCES)) throw new Error(`pracht build has no prerender stub for "${specifier}". SSG prerendering imports the server bundle in Node, where Cloudflare platform modules do not exist. Please report this so the stub list can be extended.`);
		return {
			url: `${STUB_PREFIX}${specifier}`,
			shortCircuit: true
		};
	}
	return nextResolve(specifier, context);
}
function load(url, context, nextLoad) {
	if (url.startsWith(STUB_PREFIX)) return {
		format: "module",
		source: STUB_SOURCES[url.slice(23)] ?? "",
		shortCircuit: true
	};
	return nextLoad(url, context);
}
//#endregion
export { load, resolve };
