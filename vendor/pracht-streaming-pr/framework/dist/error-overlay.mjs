//#region src/error-overlay.ts
/**
* SGR/CSI/OSC escape sequences, as emitted by every compiler that colours its own
* diagnostics (oxc, esbuild, Babel). They are meaningless in a browser: a
* terminal renders `[31m` as "red", HTML renders it as `[31m`, and oxc
* wraps *every character* of the offending source line in its own sequence, so
* an uncleaned parse error reads as a wall of `[38;5;249m` noise.
*/
const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
const BEL = String.fromCharCode(7);
const OSC_SEQUENCE = `[^${BEL}${ESC}]*${`(?:${BEL}|${ESC}\\\\)`}`;
const ANSI_ESCAPE = new RegExp(`[${ESC}${CSI}][[\\]()#;?]*(?:${OSC_SEQUENCE}|(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~])`, "g");
function stripAnsi(value) {
	return value.replace(ANSI_ESCAPE, "");
}
const FRAME_PARENS = /^\s*at\s+(?:async\s+)?.*?\((.*)\)\s*$/;
const FRAME_BARE = /^\s*at\s+(?:async\s+)?(.*?)\s*$/;
const LOCATION = /^(.*?):(\d+):(\d+)$/;
const WINDOWS_DRIVE_PATH = /^\/?[A-Za-z]:[\\/]/;
/**
* Parse a V8-style stack trace into frames. Non-frame lines (the message
* line, empty lines) are preserved as non-app frames without a location.
*/
function parseStackFrames(stack, options = {}) {
	return stack.split("\n").map((line) => parseStackFrameLine(line, options.root));
}
function parseStackFrameLine(raw, root) {
	const locationText = FRAME_PARENS.exec(raw)?.[1] ?? FRAME_BARE.exec(raw)?.[1];
	if (!locationText) return {
		raw,
		isApp: false
	};
	const location = LOCATION.exec(locationText);
	if (!location) return {
		raw,
		locationText,
		isApp: !isInternalStackPath(locationText)
	};
	const [, rawPath, line, column] = location;
	if (isInternalStackPath(rawPath)) return {
		raw,
		locationText,
		isApp: false
	};
	return {
		raw,
		locationText,
		file: normalizeStackFile(rawPath, root),
		line: Number(line),
		column: Number(column),
		isApp: true
	};
}
function isInternalStackPath(path) {
	return path === "native" || path === "<anonymous>" || path.includes("(") || path.startsWith("node:") || path.startsWith("internal/") || path.startsWith("virtual:") || path.includes("\0") || path.includes("/node_modules/") || path.includes("\\node_modules\\") || path.includes("/@vite/");
}
/**
* Normalize a stack-frame path to a filesystem path that Vite's
* `/__open-in-editor` endpoint can open. Handles `file://` URLs,
* `http://` dev-server URLs, `/@fs/` prefixes, Vite query suffixes
* (`?t=123`, `?pracht-client`), and root-relative dev URLs like
* `/src/routes/home.tsx` (joined onto `root` when provided).
*/
function normalizeStackFile(rawPath, root) {
	let path = rawPath;
	if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("file://")) try {
		const url = new URL(path);
		path = decodeURIComponent(url.pathname);
	} catch {
		return;
	}
	path = path.split("?")[0].split("#")[0];
	if (path.startsWith("/@fs/")) path = path.slice(4);
	if (WINDOWS_DRIVE_PATH.test(path) && path.startsWith("/")) path = path.slice(1);
	if (!path) return void 0;
	if (root && path.startsWith("/") && !WINDOWS_DRIVE_PATH.test(path)) {
		const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
		if (path !== normalizedRoot && !path.startsWith(`${normalizedRoot}/`)) return `${normalizedRoot}${path}`;
	}
	return path;
}
function buildErrorOverlayHtml(options) {
	const { routeId, file, root } = options;
	const message = stripAnsi(options.message);
	const stack = options.stack ? stripAnsi(options.stack) : void 0;
	const openInEditorEndpoint = resolveOpenInEditorEndpoint(options.base);
	const stackHtml = stack ? `<pre class="stack">${renderStackFrames(parseStackFrames(stack, { root }))}</pre>` : "";
	const phaseHtml = options.phase ? `<div class="meta"><span class="label">Phase</span> <span class="value">${escapeHtml(options.phase)}</span></div>` : "";
	const routeHtml = routeId ? `<div class="meta"><span class="label">Route</span> <span class="value">${escapeHtml(routeId)}</span></div>` : "";
	const fileHtml = file ? `<div class="meta"><span class="label">File</span> ${renderFileValue(file, root)}</div>` : "";
	const loaderHtml = options.loaderFile && options.loaderFile !== file ? `<div class="meta"><span class="label">Loader</span> ${renderFileValue(options.loaderFile, root)}</div>` : "";
	const shellHtml = options.shellFile ? `<div class="meta"><span class="label">Shell</span> ${renderFileValue(options.shellFile, root)}</div>` : "";
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>pracht error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 32px;
      line-height: 1.5;
    }
    .overlay {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #333;
    }
    .badge {
      background: #e74c3c;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 10px;
      border-radius: 4px;
    }
    .title {
      font-size: 14px;
      color: #888;
    }
    .message {
      font-size: 18px;
      font-weight: 600;
      color: #ff6b6b;
      margin-bottom: 20px;
      word-break: break-word;
      /* Compiler diagnostics are multi-line source frames; collapsing their
         whitespace turns the caret line into gibberish. */
      white-space: pre-wrap;
    }
    .meta {
      font-size: 13px;
      margin-bottom: 6px;
    }
    .meta .label {
      color: #888;
      margin-right: 8px;
    }
    .meta .value {
      color: #a0c4ff;
    }
    .stack {
      background: #16162a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin-top: 20px;
      font-size: 13px;
      line-height: 1.7;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #ccc;
    }
    .frame-internal {
      opacity: 0.45;
    }
    .editor-link {
      color: #a0c4ff;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .editor-link:hover {
      color: #d0e2ff;
      text-decoration-style: solid;
    }
    .hint {
      margin-top: 24px;
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="overlay">
    <div class="header">
      <span class="badge">Error</span>
      <span class="title">pracht dev</span>
    </div>
    <div class="message">${escapeHtml(message)}</div>
    ${phaseHtml}
    ${routeHtml}
    ${fileHtml}
    ${loaderHtml}
    ${shellHtml}
    ${stackHtml}
    <div class="hint">Click a stack frame to open it in your editor. Fix the error and save — the page will reload automatically.</div>
  </div>
  <script>
    // Open clicked stack frames in the editor via Vite's built-in
    // /__open-in-editor endpoint (dev server only).
    document.addEventListener("click", function (event) {
      var target = event.target;
      var link = target && target.closest ? target.closest("[data-editor-file]") : null;
      if (!link) return;
      event.preventDefault();
      fetch(${JSON.stringify(openInEditorEndpoint)} + "?file=" + encodeURIComponent(link.getAttribute("data-editor-file")));
    });
  <\/script>
  <script type="module">
    // Auto-reload when Vite publishes either an ordinary HMR update for a
    // client-reachable route or a full reload for a server-only module.
    // Must be a module: \`import.meta\` is a parse error in a classic script, so
    // a plain <script> silently dropped this whole block and the overlay never
    // reloaded itself after the underlying file was fixed.
    if (import.meta.hot) {
      var reload = function () {
        window.location.reload();
      };
      import.meta.hot.on("vite:beforeUpdate", reload);
      import.meta.hot.on("vite:beforeFullReload", reload);
    }
  <\/script>
</body>
</html>`;
}
function resolveOpenInEditorEndpoint(base) {
	if (!base || base === "/" || !base.startsWith("/") || base.startsWith("//")) return "/__open-in-editor";
	return `${base.endsWith("/") ? base : `${base}/`}__open-in-editor`;
}
function renderStackFrames(frames) {
	return frames.map(renderStackFrame).join("\n");
}
function renderStackFrame(frame) {
	if (!frame.isApp) return frame.locationText ? `<span class="frame-internal">${escapeHtml(frame.raw)}</span>` : escapeHtml(frame.raw);
	if (!frame.file || !frame.locationText) return escapeHtml(frame.raw);
	const locationIndex = frame.raw.indexOf(frame.locationText);
	if (locationIndex === -1) return escapeHtml(frame.raw);
	const prefix = frame.raw.slice(0, locationIndex);
	const suffix = frame.raw.slice(locationIndex + frame.locationText.length);
	const link = renderEditorLink(frame.file, frame.line, frame.column, frame.locationText);
	return `${escapeHtml(prefix)}${link}${escapeHtml(suffix)}`;
}
function renderEditorLink(file, line, column, label) {
	let target = file;
	if (line !== void 0) {
		target += `:${line}`;
		if (column !== void 0) target += `:${column}`;
	}
	return `<a class="editor-link" href="#" data-editor-file="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
}
function renderFileValue(file, root) {
	const resolved = resolveEditorFilePath(file, root);
	if (!resolved) return `<span class="value">${escapeHtml(file)}</span>`;
	return `<a class="value editor-link" href="#" data-editor-file="${escapeHtml(resolved)}">${escapeHtml(file)}</a>`;
}
/**
* Resolve the `file` metadata option (typically a manifest-relative path
* such as `./routes/home.tsx`) to a filesystem path for open-in-editor.
*/
function resolveEditorFilePath(file, root) {
	if (file.startsWith("./")) {
		if (!root) return void 0;
		return `${root.endsWith("/") ? root.slice(0, -1) : root}/src/${file.slice(2)}`;
	}
	if (file.startsWith("../")) return;
	return normalizeStackFile(file, root);
}
function escapeHtml(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
//#endregion
export { buildErrorOverlayHtml, normalizeStackFile, parseStackFrames, stripAnsi };
