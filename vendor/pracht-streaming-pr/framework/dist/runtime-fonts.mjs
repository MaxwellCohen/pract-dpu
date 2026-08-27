//#region src/runtime-fonts.ts
/** Replace the generated font registrations owned by the active route. */
function applyFontHeadFragments(fontHead) {
	for (const link of document.head.querySelectorAll("link[data-pracht-font-preload]")) link.remove();
	for (const descriptor of fontHead.preloadLinks) {
		const link = document.createElement("link");
		link.dataset.prachtFontPreload = "";
		for (const name of [
			"rel",
			"as",
			"type",
			"href",
			"crossorigin"
		]) {
			const value = descriptor[name];
			if (typeof value === "string") link.setAttribute(name, value);
		}
		document.head.appendChild(link);
	}
	const existing = document.head.querySelector("style[data-pracht-fonts]");
	if (existing) {
		existing.textContent = fontHead.css;
		if (!fontHead.css && !existing.nonce) existing.remove();
	} else if (fontHead.css) {
		const style = document.createElement("style");
		style.dataset.prachtFonts = "";
		style.textContent = fontHead.css;
		document.head.appendChild(style);
	}
}
//#endregion
export { applyFontHeadFragments };
