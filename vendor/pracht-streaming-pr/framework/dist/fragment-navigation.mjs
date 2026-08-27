//#region src/fragment-navigation.ts
/**
* Focus handling for fragment ("#hash") targets.
*
* Scrolling to a fragment is only half of what a fragment navigation does: it
* also moves the sequential focus navigation starting point, so the next Tab
* continues from the target rather than from the top of the page. That half is
* the entire point of a skip link, and it is missing wherever the router
* scrolls to a fragment itself instead of letting the browser navigate.
*/
/**
* Decode the id a URL fragment points at. Fragments arrive percent-encoded for
* non-ASCII ids (`#überblick` → `#%C3%BCberblick`); an invalid encoding is kept
* verbatim rather than throwing.
*/
function decodeFragmentId(hash) {
	const raw = hash.startsWith("#") ? hash.slice(1) : hash;
	if (!raw) return "";
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
/** Find the element a fragment points at, or `null` when nothing matches. */
function findFragmentTarget(doc, hash) {
	const id = decodeFragmentId(hash);
	if (!id) return null;
	return doc.getElementById(id);
}
const NATIVELY_FOCUSABLE = "a[href],area[href],button,input,select,textarea,summary,iframe,audio[controls],video[controls],[contenteditable],[tabindex]";
const TEMPORARY_TABINDEX_ATTRIBUTE = "data-pracht-fragment-tabindex";
function removeTemporaryTabIndex(event) {
	const el = event.currentTarget;
	if (!el || typeof el.hasAttribute !== "function") return;
	if (!el.hasAttribute(TEMPORARY_TABINDEX_ATTRIBUTE)) return;
	el.removeAttribute("tabindex");
	el.removeAttribute(TEMPORARY_TABINDEX_ATTRIBUTE);
}
/**
* Move focus to a fragment target the way a real fragment navigation does.
*
* Chromium sets the sequential focus navigation starting point on its own for
* a native fragment navigation, but not when the router scrolls to a fragment
* itself, and Safari has historically not set it at all — which is why
* `tabindex="-1"` on skip-link targets is the conventional belt and braces.
* Headings and landmarks are not focusable on their own, so they get a
* temporary `tabindex="-1"` that is removed again on blur: the DOM is left as
* the route authored it, and no permanent tab stop is introduced.
*/
function focusFragmentTarget(el) {
	if (typeof el.focus !== "function") return;
	if (!(typeof el.matches === "function" && el.matches(NATIVELY_FOCUSABLE))) {
		el.setAttribute("tabindex", "-1");
		el.setAttribute(TEMPORARY_TABINDEX_ATTRIBUTE, "");
		el.addEventListener("blur", removeTemporaryTabIndex, { once: true });
	}
	el.focus({ preventScroll: true });
}
/**
* Scroll a fragment target into view and give it focus.
*
* `scrollIntoView()` is deliberately called with no `behavior` option: how the
* page scrolls belongs to CSS (`scroll-behavior`), where a
* `prefers-reduced-motion` query can turn a smooth scroll off. Passing
* `"smooth"` here would override that choice for everyone.
*/
function scrollToFragmentTarget(el) {
	if (typeof el.scrollIntoView === "function") el.scrollIntoView();
	focusFragmentTarget(el);
}
//#endregion
export { decodeFragmentId, findFragmentTarget, focusFragmentTarget, scrollToFragmentTarget };
