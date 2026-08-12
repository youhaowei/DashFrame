export const REPORT_APP_URI = "ui://dashframe/report-v1.html";
export const REPORT_APP_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Self-contained by design: the sandbox needs no network or asset domains.
 * Dynamic report data arrives only through the host-owned MCP Apps bridge.
 */
export const REPORT_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DashFrame report</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #ffffff;
      --ink: #171a17;
      --muted: #687068;
      --line: #e0e4df;
      --panel: #f6f7f5;
      --accent: #196b4b;
      --accent-soft: #e2f2e9;
      --chart: #3970d1;
      --danger: #a33b32;
      --danger-soft: #fae8e5;
      --stale: #8a5a12;
      --stale-soft: #f8edd8;
      --safe-top: 0px;
      --safe-right: 0px;
      --safe-bottom: 0px;
      --safe-left: 0px;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: transparent; color: var(--ink); }
    body { padding: calc(1px + var(--safe-top)) calc(1px + var(--safe-right)) calc(1px + var(--safe-bottom)) calc(1px + var(--safe-left)); }
    button { font: inherit; }
    .shell { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--bg); }
    .header { padding: 18px 20px 14px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .eyebrow { margin: 0 0 5px; color: var(--muted); font-size: 10px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 20px; line-height: 1.2; letter-spacing: -.025em; overflow-wrap: anywhere; }
    .subtitle { margin: 5px 0 0; color: var(--muted); font-size: 12px; }
    .badge { flex: none; border-radius: 999px; padding: 6px 9px; color: var(--accent); background: var(--accent-soft); font-size: 11px; }
    .badge.stale { color: var(--stale); background: var(--stale-soft); }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-block: 1px solid var(--line); }
    .metric { min-width: 0; padding: 13px 20px; border-right: 1px solid var(--line); }
    .metric:last-child { border-right: 0; }
    .metric-label { color: var(--muted); font-size: 10px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .metric-value { margin-top: 5px; font-size: 23px; font-weight: 720; letter-spacing: -.035em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .metric-note { margin-top: 2px; color: var(--muted); font-size: 10px; }
    .report { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, 1fr); min-height: 218px; }
    .chart { min-width: 0; padding: 16px 20px; border-right: 1px solid var(--line); }
    .section-title { margin: 0 0 12px; font-size: 11px; font-weight: 680; }
    svg { display: block; width: 100%; height: 150px; overflow: visible; }
    .empty-chart { height: 150px; display: grid; place-items: center; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); font-size: 12px; text-align: center; padding: 20px; }
    .table-wrap { min-width: 0; overflow: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { max-width: 180px; padding: 9px 12px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { position: sticky; top: 0; z-index: 1; color: var(--muted); background: var(--bg); font-size: 9px; font-weight: 680; letter-spacing: .07em; text-transform: uppercase; }
    .empty-table { min-height: 180px; display: grid; place-items: center; color: var(--muted); font-size: 12px; padding: 20px; text-align: center; }
    .footer { min-height: 43px; padding: 9px 14px 9px 20px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 14px; color: var(--muted); font-size: 10px; }
    .controls { display: flex; align-items: center; gap: 7px; }
    .controls button { border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; color: var(--ink); background: var(--panel); cursor: pointer; }
    .controls button:disabled { cursor: default; opacity: .45; }
    .state { min-height: 238px; display: grid; place-items: center; padding: 34px 24px; text-align: center; }
    .state-card { max-width: 420px; }
    .state-mark { width: 38px; height: 38px; margin: 0 auto 12px; border-radius: 50%; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); font-weight: 750; }
    .state.error .state-mark { color: var(--danger); background: var(--danger-soft); }
    .state h2 { margin: 0; font-size: 16px; }
    .state p { margin: 7px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    [hidden] { display: none !important; }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1e1a;
        --ink: #f1f4f0;
        --muted: #a5ada4;
        --line: #323832;
        --panel: #232823;
        --accent: #79d4aa;
        --accent-soft: #203d31;
        --chart: #77a7ff;
        --danger: #ffaaa1;
        --danger-soft: #462b28;
        --stale: #f0c477;
        --stale-soft: #443620;
      }
    }
    :root[data-theme="dark"] {
      --bg: #1a1e1a;
      --ink: #f1f4f0;
      --muted: #a5ada4;
      --line: #323832;
      --panel: #232823;
      --accent: #79d4aa;
      --accent-soft: #203d31;
      --chart: #77a7ff;
      --danger: #ffaaa1;
      --danger-soft: #462b28;
      --stale: #f0c477;
      --stale-soft: #443620;
    }
    :root[data-theme="light"] {
      --bg: #ffffff;
      --ink: #171a17;
      --muted: #687068;
      --line: #e0e4df;
      --panel: #f6f7f5;
      --accent: #196b4b;
      --accent-soft: #e2f2e9;
      --chart: #3970d1;
      --danger: #a33b32;
      --danger-soft: #fae8e5;
      --stale: #8a5a12;
      --stale-soft: #f8edd8;
    }
    @media (max-width: 680px) {
      .header { padding: 15px 16px 12px; }
      .metrics { grid-template-columns: 1fr 1fr; }
      .metric { padding: 11px 16px; }
      .metric:nth-child(2) { border-right: 0; }
      .metric:nth-child(3) { grid-column: 1 / -1; border-top: 1px solid var(--line); }
      .report { grid-template-columns: 1fr; }
      .chart { border-right: 0; border-bottom: 1px solid var(--line); }
      .footer { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell" aria-live="polite">
    <section id="loading" class="state">
      <div class="state-card"><div class="state-mark">DF</div><h2>Preparing report</h2><p>Waiting for the server-owned frame preview.</p></div>
    </section>
    <section id="error" class="state error" hidden>
      <div class="state-card"><div class="state-mark">!</div><h2 id="error-title">Report unavailable</h2><p id="error-message">The frame could not be read.</p></div>
    </section>
    <section id="content" hidden>
      <header class="header">
        <div><p class="eyebrow">DashFrame report</p><h1 id="title"></h1><p id="subtitle" class="subtitle"></p></div>
        <span id="badge" class="badge"></span>
      </header>
      <div class="metrics">
        <div class="metric"><div class="metric-label">Rows</div><div id="rows-kpi" class="metric-value"></div><div class="metric-note">Entire immutable frame</div></div>
        <div class="metric"><div class="metric-label">Columns</div><div id="columns-kpi" class="metric-value"></div><div class="metric-note">Readable schema</div></div>
        <div class="metric"><div id="preview-kpi-label" class="metric-label">Visible rows</div><div id="preview-kpi" class="metric-value"></div><div id="preview-kpi-note" class="metric-note">Bounded preview page</div></div>
      </div>
      <div class="report">
        <section class="chart"><h2 id="chart-title" class="section-title">Preview chart</h2><div id="chart-root"></div></section>
        <section id="table-root" class="table-wrap" aria-label="Data preview"></section>
      </div>
      <footer class="footer"><span id="page-note"></span><div class="controls"><button id="prev" type="button">Previous</button><span id="page-number"></span><button id="next" type="button">Next</button></div></footer>
    </section>
  </main>
  <script>
    (function () {
      "use strict";
      var loading = document.getElementById("loading");
      var error = document.getElementById("error");
      var content = document.getElementById("content");
      var pending = new Map();
      var requestId = 1;
      var report = null;
      var paging = false;
      var bridgeInitialized = false;
      var resizeObserver = null;
      var resizeFrame = 0;
      var lastReportedSize = "";

      function finite(value) { return typeof value === "number" && Number.isFinite(value); }
      function record(value) { return value && typeof value === "object" && !Array.isArray(value); }
      function owns(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
      function text(value, fallback) { return typeof value === "string" ? value : fallback; }
      function whole(value, fallback) { return finite(value) && value >= 0 && Number.isInteger(value) ? value : fallback; }
      function formatNumber(value) { return new Intl.NumberFormat(document.documentElement.lang || "en-US", { maximumFractionDigits: 2 }).format(value); }
      function valueText(value, type) {
        if (value === null) return "null";
        if (type === "date" && finite(value)) return new Intl.DateTimeFormat(document.documentElement.lang || "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        try { return JSON.stringify(value); } catch (_) { return "[value]"; }
      }
      function setText(id, value) { document.getElementById(id).textContent = value; }
      function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
      function showError(title, message) {
        loading.hidden = true; content.hidden = true; error.hidden = false;
        setText("error-title", title); setText("error-message", message);
        reportSize();
      }
      function parseReady(value) {
        if (!record(value) || value.status !== "ready" || !record(value.report)) return null;
        var next = value.report;
        if (typeof next.dataFrameId !== "string" || !Array.isArray(next.schema) || !Array.isArray(next.rows) || !record(next.page)) return null;
        var fullSchema = next.schema.filter(function (field) { return record(field) && typeof field.id === "string" && typeof field.name === "string" && typeof field.type === "string"; });
        var schema = fullSchema.slice(0, 100);
        var rows = next.rows.filter(record).slice(0, 100).map(function (row) {
          var normalized = {};
          schema.forEach(function (field) {
            normalized[field.id] = owns(row, field.id) ? row[field.id] : owns(row, field.name) ? row[field.name] : null;
          });
          return normalized;
        });
        return {
          title: text(next.title, "DashFrame data report"),
          dataFrameId: next.dataFrameId,
          schema: schema,
          rows: rows,
          columnCount: whole(next.columnCount, fullSchema.length),
          totalCount: whole(next.totalCount, 0),
          page: { offset: whole(next.page.offset, 0), limit: Math.min(100, Math.max(1, whole(next.page.limit, 50))), returned: whole(next.page.returned, 0) },
          freshness: record(next.freshness) ? { state: text(next.freshness.state, "snapshot"), fetchedAt: finite(next.freshness.fetchedAt) ? next.freshness.fetchedAt : null } : { state: "snapshot", fetchedAt: null }
        };
      }
      function numericField(schema, rows) {
        return schema.find(function (field) { return field.type === "number" && rows.some(function (row) { return finite(row[field.id]); }); }) || null;
      }
      function labelField(schema, numeric) {
        return schema.find(function (field) { return !numeric || field.id !== numeric.id; }) || null;
      }
      function renderChart(current) {
        var root = document.getElementById("chart-root"); clear(root);
        var numeric = numericField(current.schema, current.rows);
        var label = labelField(current.schema, numeric);
        if (!numeric || current.rows.length < 2) {
          var empty = document.createElement("div"); empty.className = "empty-chart";
          empty.textContent = current.rows.length === 0 ? "This frame has no rows to chart." : "Add at least two numeric rows for a preview chart.";
          root.appendChild(empty); setText("chart-title", "Preview chart"); return;
        }
        var points = current.rows.map(function (row, index) { return { index: index, value: finite(row[numeric.id]) ? row[numeric.id] : null }; }).filter(function (point) { return point.value !== null; }).slice(0, 50);
        if (points.length < 2) { var missing = document.createElement("div"); missing.className = "empty-chart"; missing.textContent = "The current page has too few numeric values to chart."; root.appendChild(missing); return; }
        var values = points.map(function (point) { return point.value; });
        var min = Math.min.apply(Math, values); var max = Math.max.apply(Math, values); var span = max - min || 1;
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 520 160"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Bounded preview of " + numeric.name);
        [35, 80, 125].forEach(function (y) { var grid = document.createElementNS(svg.namespaceURI, "line"); grid.setAttribute("x1", "0"); grid.setAttribute("x2", "520"); grid.setAttribute("y1", String(y)); grid.setAttribute("y2", String(y)); grid.setAttribute("stroke", "var(--line)"); svg.appendChild(grid); });
        var path = document.createElementNS(svg.namespaceURI, "polyline");
        path.setAttribute("points", points.map(function (point, index) { var x = points.length === 1 ? 260 : index * 520 / (points.length - 1); var y = 142 - ((point.value - min) / span) * 120; return x.toFixed(1) + "," + y.toFixed(1); }).join(" "));
        path.setAttribute("fill", "none"); path.setAttribute("stroke", "var(--chart)"); path.setAttribute("stroke-width", "3"); path.setAttribute("stroke-linejoin", "round"); path.setAttribute("stroke-linecap", "round"); svg.appendChild(path); root.appendChild(svg);
        setText("chart-title", "Preview · " + numeric.name + (label ? " by " + label.name : ""));
      }
      function renderTable(current) {
        var root = document.getElementById("table-root"); clear(root);
        if (current.rows.length === 0 || current.schema.length === 0) { var empty = document.createElement("div"); empty.className = "empty-table"; empty.textContent = "This frame is ready but contains no preview rows."; root.appendChild(empty); return; }
        var table = document.createElement("table"); var head = document.createElement("thead"); var headerRow = document.createElement("tr");
        current.schema.forEach(function (field) { var th = document.createElement("th"); th.textContent = field.name; th.title = field.name; headerRow.appendChild(th); }); head.appendChild(headerRow); table.appendChild(head);
        var body = document.createElement("tbody"); current.rows.forEach(function (row) { var tr = document.createElement("tr"); current.schema.forEach(function (field) { var td = document.createElement("td"); var displayed = valueText(row[field.id], field.type); td.textContent = displayed; td.title = displayed; tr.appendChild(td); }); body.appendChild(tr); }); table.appendChild(body); root.appendChild(table);
      }
      function render(current) {
        report = current; loading.hidden = true; error.hidden = true; content.hidden = false;
        setText("title", current.title); setText("subtitle", formatNumber(current.totalCount) + " rows · " + formatNumber(current.columnCount) + " columns");
        var badge = document.getElementById("badge"); badge.className = "badge" + (current.freshness.state === "stale" ? " stale" : "");
        if (current.freshness.state === "stale") badge.textContent = "Stale snapshot";
        else if (current.freshness.fetchedAt) badge.textContent = "Fetched " + new Intl.DateTimeFormat(document.documentElement.lang || "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(current.freshness.fetchedAt));
        else badge.textContent = "Snapshot ready";
        setText("rows-kpi", formatNumber(current.totalCount)); setText("columns-kpi", formatNumber(current.columnCount));
        var numeric = numericField(current.schema, current.rows);
        if (numeric) { var numbers = current.rows.map(function (row) { return row[numeric.id]; }).filter(finite); var average = numbers.reduce(function (sum, value) { return sum + value; }, 0) / Math.max(1, numbers.length); setText("preview-kpi-label", "Preview avg · " + numeric.name); setText("preview-kpi", formatNumber(average)); setText("preview-kpi-note", formatNumber(numbers.length) + " values on this page"); }
        else { setText("preview-kpi-label", "Visible rows"); setText("preview-kpi", formatNumber(current.rows.length)); setText("preview-kpi-note", "Bounded preview page"); }
        renderChart(current); renderTable(current); updatePaging();
        reportSize();
      }
      function updatePaging(message) {
        if (!report) return;
        var start = report.totalCount === 0 ? 0 : report.page.offset + 1; var end = Math.min(report.totalCount, report.page.offset + report.rows.length);
        setText("page-note", message || ("Showing " + formatNumber(start) + "–" + formatNumber(end) + " of " + formatNumber(report.totalCount) + ". Preview values only; frame-wide totals are labeled."));
        setText("page-number", "Page " + formatNumber(Math.floor(report.page.offset / report.page.limit) + 1));
        document.getElementById("prev").disabled = paging || report.page.offset === 0;
        document.getElementById("next").disabled = paging || report.page.offset + report.rows.length >= report.totalCount;
      }
      // The parent window is the app's trust boundary. MCP hosts or their
      // sandbox proxy validate origins; this opaque-origin app validates source.
      function request(method, params) {
        var id = requestId++; window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
        return new Promise(function (resolve, reject) { pending.set(id, { resolve: resolve, reject: reject }); });
      }
      function callTool(name, args) {
        if (window.openai && typeof window.openai.callTool === "function") return window.openai.callTool(name, args);
        return request("tools/call", { name: name, arguments: args });
      }
      function notify(method, params) { window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params || {} }, "*"); }
      function reportSize() {
        var legacyResize = window.openai && typeof window.openai.notifyIntrinsicHeight === "function";
        if ((!bridgeInitialized && !legacyResize) || resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(function () {
          resizeFrame = 0;
          var width = Math.ceil(document.documentElement.scrollWidth);
          var height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
          var size = width + "x" + height;
          if (size === lastReportedSize) return;
          lastReportedSize = size;
          if (bridgeInitialized) notify("ui/notifications/size-changed", { width: width, height: height });
          if (legacyResize) window.openai.notifyIntrinsicHeight(height);
        });
      }
      function startSizeReporting() {
        if (bridgeInitialized) return;
        bridgeInitialized = true;
        if (typeof ResizeObserver === "function") {
          resizeObserver = new ResizeObserver(reportSize);
          resizeObserver.observe(document.documentElement);
          resizeObserver.observe(document.body);
        }
        reportSize();
      }
      function stopSizeReporting() {
        if (resizeObserver) resizeObserver.disconnect();
        if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
        resizeObserver = null; resizeFrame = 0; bridgeInitialized = false;
      }
      function applyHostContext(hostContext) {
        if (!record(hostContext)) return;
        if (hostContext.theme === "light" || hostContext.theme === "dark") document.documentElement.dataset.theme = hostContext.theme;
        if (typeof hostContext.locale === "string") document.documentElement.lang = hostContext.locale;
        // The report owns a small semantic palette; host theme selects its
        // light/dark variant instead of injecting unused style variables.
        var insets = record(hostContext.safeAreaInsets) ? hostContext.safeAreaInsets : null;
        if (insets) ["top", "right", "bottom", "left"].forEach(function (side) { var value = insets[side]; if (finite(value) && value >= 0 && value <= 200) document.documentElement.style.setProperty("--safe-" + side, value + "px"); });
      }
      function acceptToolOutput(payload) {
        if (record(payload) && payload.status === "failed") { showError("Report unavailable", text(payload.message, "The server-owned frame could not be read.")); return; }
        var ready = parseReady(payload); if (!ready) { showError("Report unavailable", "The host returned an invalid or unsupported report result."); return; } render(ready);
      }
      async function loadPage(offset) {
        if (!report || paging) return; paging = true; updatePaging("Loading the requested page…");
        var pageMessage = null;
        try {
          var result = await callTool("query_data_frame", { dataFrameId: report.dataFrameId, offset: offset, limit: report.page.limit });
          if (!record(result) || !record(result.structuredContent) || result.structuredContent.status !== "ready") throw new Error("The requested page is unavailable.");
          var page = result.structuredContent; var next = parseReady({ status: "ready", report: { title: report.title, dataFrameId: report.dataFrameId, schema: page.schema, rows: page.rows, columnCount: report.columnCount, totalCount: page.totalCount, page: page.page, freshness: report.freshness } });
          if (!next) throw new Error("The server returned an invalid page."); render(next);
        } catch (reason) { pageMessage = reason instanceof Error ? reason.message : "The requested page is unavailable."; }
        finally { paging = false; updatePaging(pageMessage); }
      }
      document.getElementById("prev").addEventListener("click", function () { if (report) loadPage(Math.max(0, report.page.offset - report.page.limit)); });
      document.getElementById("next").addEventListener("click", function () { if (report) loadPage(report.page.offset + report.page.limit); });
      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return; var message = event.data; if (!record(message) || message.jsonrpc !== "2.0") return;
        if (message.id !== undefined && pending.has(message.id)) { var waiting = pending.get(message.id); pending.delete(message.id); if (waiting.timer) window.clearTimeout(waiting.timer); if (message.error) waiting.reject(message.error); else waiting.resolve(message.result); return; }
        if (message.method === "ui/resource-teardown" && message.id !== undefined) { stopSizeReporting(); window.parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*"); return; }
        if (message.method === "ui/notifications/host-context-changed") { applyHostContext(message.params); return; }
        if (message.method === "ui/notifications/tool-result") acceptToolOutput(record(message.params) ? message.params.structuredContent : null);
      }, { passive: true });
      window.addEventListener("openai:set_globals", function (event) {
        var detail = record(event.detail) ? event.detail : null;
        var globals = detail && record(detail.globals) ? detail.globals : detail;
        if (globals && record(globals.toolOutput)) acceptToolOutput(globals.toolOutput);
        if (globals && (globals.theme === "light" || globals.theme === "dark")) applyHostContext({ theme: globals.theme });
      }, { passive: true });
      var initializeId = requestId;
      var initialize = request("ui/initialize", {
        appInfo: { name: "dashframe-report", version: "1.0.0" },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: "2026-01-26"
      });
      var initializeTimer = window.setTimeout(function () {
        var waiting = pending.get(initializeId);
        if (!waiting) return;
        pending.delete(initializeId);
        waiting.reject(new Error("The host did not answer ui/initialize."));
      }, 2000);
      var waitingForInitialize = pending.get(initializeId);
      if (waitingForInitialize) waitingForInitialize.timer = initializeTimer;
      initialize.then(function (initialized) {
        if (record(initialized)) applyHostContext(initialized.hostContext);
        notify("ui/notifications/initialized", {});
        startSizeReporting();
      }).catch(function () {
        // Compatibility hosts may deliver tool output without the standard
        // handshake response; content and intrinsic sizing remain usable.
        startSizeReporting();
      });
      if (window.openai) {
        if (record(window.openai.toolOutput)) acceptToolOutput(window.openai.toolOutput);
      }
    }());
  </script>
</body>
</html>`;
