//#region src/runtime-timing.ts
const PHASE_ORDER = [
	"mw",
	"loader",
	"render"
];
/**
* Format collected phase timings as a standards-compliant `Server-Timing`
* header value, e.g. `mw;dur=1.2, loader;dur=14.8, render;dur=3.1`.
* Returns an empty string when nothing was recorded.
*/
function formatServerTimingHeader(timings) {
	const entries = [];
	for (const phase of PHASE_ORDER) {
		const duration = timings[phase];
		if (typeof duration === "number" && Number.isFinite(duration)) entries.push(`${phase};dur=${formatDuration(duration)}`);
	}
	return entries.join(", ");
}
function formatDuration(duration) {
	return String(Math.max(0, Math.round(duration * 10) / 10));
}
//#endregion
export { formatServerTimingHeader };
