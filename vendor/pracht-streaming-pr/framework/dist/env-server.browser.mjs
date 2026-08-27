//#region src/env-server.browser.ts
const MESSAGE = "[pracht] @pracht/core/env/server was imported in client code. serverEnv is server-only — use publicEnv (PRACHT_PUBLIC_-prefixed variables) in code that ships to the browser.";
function setServerEnv() {
	throw new Error(MESSAGE);
}
const serverEnv = new Proxy(Object.create(null), {
	get() {
		throw new Error(MESSAGE);
	},
	has() {
		throw new Error(MESSAGE);
	},
	ownKeys() {
		throw new Error(MESSAGE);
	}
});
//#endregion
export { serverEnv, setServerEnv };
