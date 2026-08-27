//#region src/env.ts
/**
* Prefix that marks an environment variable as safe to expose to the client.
* The pracht Vite plugin adds this prefix to Vite's `envPrefix`, so matching
* variables are statically inlined into `import.meta.env` at build time.
*/
const PRACHT_PUBLIC_ENV_PREFIX = "PRACHT_PUBLIC_";
/**
* Returns the subset of `source` whose keys start with `PRACHT_PUBLIC_` and
* whose values are strings. Everything else is dropped.
*/
function filterPublicEnv(source) {
	const result = {};
	if (!source) return result;
	for (const [key, value] of Object.entries(source)) {
		if (!key.startsWith("PRACHT_PUBLIC_")) continue;
		if (typeof value !== "string") continue;
		result[key] = value;
	}
	return result;
}
function readPublicEnvSource() {
	if (typeof __PRACHT_PUBLIC_ENV__ !== "undefined") return __PRACHT_PUBLIC_ENV__;
	const devEnv = import.meta["env"];
	if (devEnv) return devEnv;
	if (typeof process !== "undefined" && process.env) return process.env;
}
/**
* Client-safe environment access. Only exposes variables prefixed with
* `PRACHT_PUBLIC_`; values are inlined into the client bundle at build time,
* so never put secrets behind the prefix. Safe to import anywhere.
*/
const publicEnv = Object.freeze(filterPublicEnv(readPublicEnvSource()));
//#endregion
export { PRACHT_PUBLIC_ENV_PREFIX, filterPublicEnv, publicEnv };
