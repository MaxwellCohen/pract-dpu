//#region src/script-escape.ts
/** Script types whose content is JSON, where `\uXXXX` escapes are always valid. */
const JSON_SCRIPT_TYPE_RE = /^(?:application\/(?:[^\s;]*\+)?json|importmap|speculationrules)\s*(?:;|$)/i;
/**
* Escape user-authored inline `<script>` children for HTML embedding.
*
* JSON payloads can safely escape every HTML-significant character. JavaScript
* source needs a narrower transform: replacing the `s` in `<script` and
* `<\/script` with an equivalent Unicode escape prevents the HTML parser from
* recognizing either token while preserving string, regex, comment, and
* compact comparison forms such as `value<scriptLimit`. The legacy `<!--`
* token is broken with an identity escape for its `!`.
*/
function escapeScriptChildren(value, type) {
	if (type && JSON_SCRIPT_TYPE_RE.test(type.trim())) return escapeJsonScriptText(value);
	return value.replace(/<(\/?)(script)|<!--/gi, (_match, slash, script) => {
		if (script) return `<${slash}${script[0] === "S" ? "\\u0053" : "\\u0073"}${script.slice(1)}`;
		return "<\\!--";
	});
}
function escapeJsonScriptText(value) {
	return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
//#endregion
export { escapeScriptChildren };
