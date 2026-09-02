import { buildAppGraph, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities } from "./app-graph.mjs";
//#region src/devtools.ts
const DEVTOOLS_PATH = "/_pracht";
const DEVTOOLS_JSON_PATH = "/_pracht.json";
function buildDevtoolsHtml(graph, options = {}) {
	const base = options.base ?? "/";
	const mcpRuntimeStatus = graph.mcpRuntimeStatus ?? (!graph.mcpEndpoint ? "not-configured" : (graph.mcpUnavailableReasons?.length ?? 0) > 0 ? "blocked" : "ready");
	const routeRows = graph.routes.map((route) => `<tr>
        <td>${routeLinkHtml(route, base)}</td>
        <td>${escapeHtml(route.render ?? "ssr")}</td>
        <td>${escapeHtml(route.shell ?? "—")}</td>
        <td>${escapeHtml(route.middleware.length > 0 ? route.middleware.join(" → ") : "—")}</td>
        <td class="file">${escapeHtml(route.file)}</td>
      </tr>`).join("\n");
	const notFoundRow = graph.notFound ? `<tr>
        <td>${escapeHtml(graph.notFound.path)}</td>
        <td>404</td>
        <td>${escapeHtml(graph.notFound.shell ?? "—")}</td>
        <td>${escapeHtml(graph.notFound.middleware.length > 0 ? graph.notFound.middleware.join(" → ") : "—")}</td>
        <td class="file">${escapeHtml(graph.notFound.file)}</td>
      </tr>` : "";
	const apiRows = graph.api.map((route) => `<tr>
        <td>${apiLinkHtml(route, base)}</td>
        <td>${escapeHtml(route.methods.length > 0 ? route.methods.join(", ") : "—")}</td>
        <td class="file">${escapeHtml(route.file)}</td>
      </tr>`).join("\n");
	const capabilityRows = (graph.capabilities ?? []).map((capability) => {
		const transports = capability.transports.map((transport) => transport !== "mcp" ? transport : !graph.mcpEndpoint || capability.effect === "destructive" && graph.mcpDestructive !== true || mcpRuntimeStatus === "blocked" ? "mcp(unserved)" : mcpRuntimeStatus === "unverified" ? "mcp(unverified)" : transport);
		return `<tr>
        <td>${escapeHtml(capability.name)}</td>
        <td>${escapeHtml(capability.effect ?? "—")}</td>
        <td>${escapeHtml(transports.length > 0 ? transports.join(", ") : "private")}</td>
        <td>${escapeHtml(capability.httpPath ?? "—")}</td>
        <td>${escapeHtml(capability.middleware.length > 0 ? capability.middleware.join(" → ") : "—")}</td>
        <td class="file">${escapeHtml(capability.source)}</td>
      </tr>`;
	}).join("\n");
	const capabilitiesSection = (graph.capabilities ?? []).length > 0 ? `<h2>Capabilities</h2>
    ${graph.mcpUnavailableReasons?.length ? `<p class="warning">MCP endpoint ${mcpRuntimeStatus === "unverified" ? "unverified" : "unavailable"}: ${escapeHtml(graph.mcpUnavailableReasons.join(" "))}</p>` : ""}
    <table>
      <thead><tr><th>Name</th><th>Effect</th><th>Transports</th><th>HTTP path</th><th>Middleware</th><th>Source</th></tr></thead>
      <tbody>
${capabilityRows}
      </tbody>
    </table>` : "";
	const trafficEvents = options.agentTraffic?.events ?? [];
	const trafficKinds = trafficEvents.map(classifyAgentTraffic);
	const agentCount = trafficKinds.filter((kind) => kind === "agent").length;
	const unverifiedDispatchCount = trafficKinds.filter((kind) => kind === "unverified-client").length;
	const composedCount = trafficKinds.filter((kind) => kind === "first-party").length;
	const droppedCount = Math.max(0, (options.agentTraffic?.recorded ?? trafficEvents.length) - trafficEvents.length);
	const trafficRows = trafficEvents.map((event) => `<tr${classifyAgentTraffic(event) === "first-party" ? ` class="composed"` : ""}>
        <td class="file">${escapeHtml(formatEventTime(event.at))}</td>
        <td>${escapeHtml(event.capability)}</td>
        <td>${escapeHtml(formatTransport(event))}</td>
        <td>${escapeHtml(event.effect)}</td>
        <td>${escapeHtml(formatAgent(event.agent))}</td>
        <td class="${agentTrafficSucceeded(event) ? "ok" : "err"}">${escapeHtml(formatOutcome(event))}</td>
        <td class="file">${escapeHtml(formatDuration(event.durationMs))}</td>
      </tr>`).join("\n");
	const trafficTable = `${composedCount > 0 ? `<input type="checkbox" id="pracht-show-composed" class="toggle-input">
    <label class="toggle" for="pracht-show-composed">Show ${composedCount} first-party <code>invokeCapability()</code> dispatch${composedCount === 1 ? "" : "es"}</label>
    ` : ""}<table>
      <thead><tr><th>Time (UTC)</th><th>Capability</th><th>Transport</th><th>Effect</th><th>Agent</th><th>Outcome</th><th>Duration</th></tr></thead>
      <tbody>
${trafficRows}
      </tbody>
    </table>`;
	const agentsSection = (graph.capabilities ?? []).length > 0 || (options.agentTraffic?.recorded ?? 0) > 0 ? `<h2>Agents${agentTrafficCaption(options.agentTraffic, agentCount, unverifiedDispatchCount, composedCount)}</h2>
    ${trafficEvents.length === 0 ? `<p class="empty">No capability dispatches recorded yet. Call a capability over HTTP, WebMCP, or MCP and reload.</p>` : agentCount === 0 && unverifiedDispatchCount === 0 ? `<p class="empty">${droppedCount > 0 ? "No agent-attributed traffic in the retained window. Older dropped dispatches may include agent traffic." : "No agent-attributed traffic yet — every recorded dispatch is this app calling itself."}</p>
    ${trafficTable}` : agentCount === 0 ? `<p class="empty">No agent-attributed traffic in the retained window. Unverified HTTP-caused and WebMCP dispatches may be people, agents, or other clients.</p>
    ${trafficTable}` : trafficTable}` : "";
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>pracht devtools</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 32px;
      line-height: 1.5;
    }
    .devtools {
      max-width: 1100px;
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
      background: #4c6ef5;
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
    .title a {
      color: #a0c4ff;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      color: #a0c4ff;
      margin: 24px 0 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      color: #888;
      font-weight: 600;
      padding: 6px 12px 6px 0;
      border-bottom: 1px solid #333;
    }
    td {
      padding: 6px 12px 6px 0;
      border-bottom: 1px solid #26263e;
      vertical-align: top;
      word-break: break-word;
    }
    td a {
      color: #74c0fc;
    }
    .file {
      color: #888;
    }
    .ok {
      color: #8ce99a;
    }
    .err {
      color: #ffa8a8;
    }
    /* CSS-only disclosure: the page ships no JavaScript of its own. */
    .toggle-input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .toggle {
      display: inline-block;
      margin-bottom: 10px;
      font-size: 12px;
      color: #a0c4ff;
      cursor: pointer;
      border-bottom: 1px dotted #4c6ef5;
    }
    .toggle-input:focus-visible + .toggle {
      outline: 2px solid #4c6ef5;
      outline-offset: 2px;
    }
    tr.composed {
      display: none;
    }
    .toggle-input:checked ~ table tr.composed {
      display: table-row;
    }
    .empty {
      font-size: 13px;
      color: #888;
    }
    .hint {
      margin-top: 24px;
      font-size: 12px;
      color: #666;
    }
    .hint a {
      color: #a0c4ff;
    }
  </style>
</head>
<body>
  <div class="devtools">
    <div class="header">
      <span class="badge">pracht</span>
      <span class="title">devtools — resolved app graph (dev only)</span>
    </div>
    <h2>Page routes</h2>
    <table>
      <thead><tr><th>Route</th><th>Render</th><th>Shell</th><th>Middleware</th><th>Source</th></tr></thead>
      <tbody>
${routeRows}
${notFoundRow}
      </tbody>
    </table>
    ${graph.api.length > 0 ? `<h2>API routes</h2>
    <table>
      <thead><tr><th>Path</th><th>Methods</th><th>Source</th></tr></thead>
      <tbody>
${apiRows}
      </tbody>
    </table>` : `<h2>API routes</h2>
    <p class="empty">No API routes found.</p>`}
    ${capabilitiesSection}
    ${agentsSection}
    <div class="hint">
      Raw JSON at <a href="${escapeHtml(withDevBase(DEVTOOLS_JSON_PATH, base))}">${DEVTOOLS_JSON_PATH}</a> ·
      same graph as <code>pracht inspect --json</code>, plus a dev-only
      <code>agentTraffic</code> log ·
      configured agent surface: <code>pracht inspect agents</code> ·
      per-request middleware/loader/render timings are on the <code>Server-Timing</code>
      response header in the browser Network panel.
    </div>
  </div>
</body>
</html>`;
}
function classifyAgentTraffic(event) {
	if (event.agent !== null || event.transport === "mcp" || event.via === "mcp") return "agent";
	if (event.transport === "http" || event.transport === "webmcp" || event.via === "http") return "unverified-client";
	return "first-party";
}
/**
* `— 3 agent-attributed dispatches (mcp 3) · 3 unverified client dispatches ·
* 8 first-party · 4 older dropped`. The separate unverified count prevents
* human form, browser-client, and spoofed WebMCP calls from masquerading as
* agent activation, and the dropped count tells a reader that the visible log
* is only a tail.
*/
function agentTrafficCaption(traffic, agentCount, unverifiedDispatchCount, composedCount) {
	if (!traffic || traffic.recorded === 0) return "";
	const byTransport = /* @__PURE__ */ new Map();
	for (const event of traffic.events) {
		if (classifyAgentTraffic(event) !== "agent") continue;
		byTransport.set(event.transport, (byTransport.get(event.transport) ?? 0) + 1);
	}
	const breakdown = [...byTransport].map(([transport, count]) => `${transport} ${count}`).join(" · ");
	const parts = [`${agentCount} agent-attributed dispatch${agentCount === 1 ? "" : "es"}`];
	if (breakdown !== "") parts[0] += ` (${breakdown})`;
	if (unverifiedDispatchCount > 0) parts.push(`${unverifiedDispatchCount} unverified client dispatch${unverifiedDispatchCount === 1 ? "" : "es"}`);
	if (composedCount > 0) parts.push(`${composedCount} first-party`);
	const dropped = Math.max(0, traffic.recorded - traffic.events.length);
	if (dropped > 0) parts.push(`${dropped} older dropped`);
	return escapeHtml(` — ${parts.join(" · ")}`);
}
/** `HH:MM:SS.mmm` in UTC — stable across locales and trivially testable. */
function formatEventTime(at) {
	return new Date(at).toISOString().slice(11, 23);
}
/**
* A nested dispatch is rendered as `http → server`: the transport the request
* arrived on, then the composed dispatch it caused.
*/
function formatTransport(event) {
	return event.via ? `${event.via} → ${event.transport}` : event.transport;
}
/**
* In-process dispatch is routinely sub-millisecond; rounding those to `0ms`
* reads as "not measured" rather than "fast".
*/
function formatDuration(durationMs) {
	return durationMs < 1 ? "<1ms" : `${Math.round(durationMs)}ms`;
}
function formatOutcome(event) {
	return `${event.outcome} (${event.status})`;
}
/**
* A completed dispatch normally has a 2xx status. The progressive no-JS form
* path is the exception: after the capability succeeds it redirects back to
* the document with `outcome: "ok"`. Middleware redirects also have a 3xx
* status, but their `middleware_3xx` outcome means the capability never ran.
*/
function agentTrafficSucceeded(event) {
	return event.outcome === "ok" || event.status >= 200 && event.status < 300;
}
function formatAgent(agent) {
	if (!agent) return "—";
	return agent.agentDomain ?? agent.keyId;
}
function routeLinkHtml(route, base) {
	const label = escapeHtml(route.path);
	if (!isLinkablePath(route.path)) return label;
	return `<a href="${escapeHtml(withDevBase(route.path, base))}">${label}</a>`;
}
function apiLinkHtml(route, base) {
	const label = escapeHtml(route.path);
	if (!isLinkablePath(route.path) || !route.methods.includes("GET")) return label;
	return `<a href="${escapeHtml(withDevBase(route.path, base))}">${label}</a>`;
}
function withDevBase(path, base) {
	if (base === "/" || !path.startsWith("/")) return path;
	return `${base.endsWith("/") ? base : `${base}/`}${path.slice(1)}`;
}
/** Dynamic patterns (`:id`, `*`) are not navigable as-is — render them as text. */
function isLinkablePath(path) {
	return !path.includes(":") && !path.includes("*");
}
function escapeHtml(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
//#endregion
export { DEVTOOLS_JSON_PATH, DEVTOOLS_PATH, buildAppGraph, buildDevtoolsHtml, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities };
