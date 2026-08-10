import { createServer } from "node:http";
import { evaluateMonitor, formatDuration } from "./model.js";
import { openStore } from "./db.js";

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ops Canary</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    body { margin: 0; background: #0b0d10; color: #ecf1e9; }
    main { max-width: 980px; margin: 0 auto; padding: 48px 24px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: end; }
    h1 { margin: 0; font-size: clamp(2rem, 7vw, 4.5rem); letter-spacing: -.08em; }
    .lede { color: #99a397; max-width: 62ch; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); gap: 14px; margin-top: 32px; }
    article { border: 1px solid #293027; border-radius: 14px; padding: 18px; background: #111510; }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    h2 { margin: 0; font-size: 1rem; }
    .state { border: 1px solid currentColor; border-radius: 999px; padding: 4px 8px; font-size: .72rem; text-transform: uppercase; }
    .on-time { color: #8be28b; } .late { color: #ffd166; } .missing { color: #ff6b6b; }
    .duplicate { color: #c99cff; } .unknown { color: #94a3b8; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 8px; color: #a9b2a6; font-size: .8rem; }
    dd { margin: 0; color: #ecf1e9; }
    .detail { min-height: 3em; color: #bdc6ba; font-size: .82rem; line-height: 1.5; }
    footer { margin-top: 30px; color: #737e72; font-size: .72rem; line-height: 1.5; }
    #empty { border: 1px dashed #394238; padding: 28px; border-radius: 14px; color: #99a397; }
  </style>
</head>
<body>
<main>
  <header><div><h1>OPS CANARY</h1><p class="lede">Payload-free evidence that expected heartbeat IDs arrived once and on time.</p></div><span id="clock"></span></header>
  <section id="grid" class="grid" aria-live="polite"></section>
  <footer>Receipt timing is not proof of workflow correctness, downstream effects, source availability, or business transaction success.</footer>
</main>
<script>
const grid = document.querySelector("#grid");
const fmt = value => value == null ? "never" : new Date(value).toLocaleString();
async function refresh() {
  try {
    const response = await fetch("/api/monitors", { cache: "no-store" });
    const data = await response.json();
    grid.replaceChildren();
    if (!data.monitors.length) {
      const empty = document.createElement("p");
      empty.id = "empty";
      empty.textContent = "No monitors yet. Run: ops-canary add my-workflow --every 5m";
      grid.append(empty);
    }
    for (const item of data.monitors) {
      const card = document.createElement("article");
      const top = document.createElement("div"); top.className = "top";
      const title = document.createElement("h2"); title.textContent = item.id;
      const state = document.createElement("span"); state.className = "state " + item.state; state.textContent = item.state;
      top.append(title, state);
      const detail = document.createElement("p"); detail.className = "detail"; detail.textContent = item.detail;
      const facts = document.createElement("dl");
      const rows = [["last observed", fmt(item.lastObservedAt)], ["next deadline", fmt(item.deadlineAt)], ["events", item.eventCount], ["duplicates", item.duplicateCount]];
      for (const [label, value] of rows) {
        const dt = document.createElement("dt"); dt.textContent = label;
        const dd = document.createElement("dd"); dd.textContent = value;
        facts.append(dt, dd);
      }
      card.append(top, detail, facts); grid.append(card);
    }
    document.querySelector("#clock").textContent = new Date(data.now).toLocaleTimeString();
  } catch {
    grid.textContent = "Receiver unavailable.";
  }
}
refresh(); setInterval(refresh, 5000);
</script>
</body>
</html>`;
}

export function createOpsServer(options = {}) {
  const store = options.store ?? openStore(options.dbPath);
  const ownsStore = !options.store;
  const clock = options.clock ?? Date.now;
  const maxContinuityGapMs = options.continuityGapMs ?? 5_000;
  let continuitySince = options.continuitySince ?? clock();
  let lastContinuityCheck = clock();
  const observeContinuity = () => {
    const now = clock();
    if (now - lastContinuityCheck > maxContinuityGapMs) continuitySince = now;
    lastContinuityCheck = now;
    return { now, continuitySince };
  };
  const continuityTimer = setInterval(observeContinuity, 1_000);
  continuityTimer.unref();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        const html = dashboardHtml();
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(html),
          "x-content-type-options": "nosniff",
        });
        response.end(html);
        return;
      }

      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "public, max-age=86400" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/healthz") {
        const continuity = observeContinuity();
        sendJson(response, 200, { ok: true, continuitySince: continuity.continuitySince });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/monitors") {
        const { now, continuitySince: currentContinuitySince } = observeContinuity();
        store.prune(now);
        const monitors = store
          .listMonitors()
          .map((monitor) =>
            evaluateMonitor(monitor, store.listEvents(monitor.id), {
              now,
              continuitySince: currentContinuitySince,
            }),
          );
        sendJson(response, 200, { now, continuitySince: currentContinuitySince, monitors });
        return;
      }

      const match = url.pathname.match(/^\/api\/heartbeat\/([^/]+)$/);
      if (request.method === "POST" && match) {
        const { now: receivedAt } = observeContinuity();
        const id = decodeURIComponent(match[1]);
        const authorization = request.headers.authorization ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        if (!store.authorize(id, token)) {
          request.resume();
          sendJson(response, 404, { error: "Monitor not found." });
          return;
        }
        const contentLength = Number(request.headers["content-length"] ?? 0);
        if (request.headers["transfer-encoding"] || contentLength > 0) {
          request.resume();
          sendJson(response, 413, { error: "Heartbeat requests must not include a body." });
          return;
        }
        const eventId = request.headers["x-ops-event-id"] ?? null;
        const receipt = store.recordHeartbeat({ id, token, eventId, now: receivedAt });
        if (!receipt) {
          sendJson(response, 404, { error: "Monitor not found." });
          return;
        }
        sendJson(response, 202, {
          observed: true,
          duplicate: receipt.duplicate,
          receivedAt: receipt.receivedAt,
          note: "Receipt observed; workflow correctness was not evaluated.",
        });
        return;
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendJson(response, error.status ?? 400, { error: error.message });
    }
  });

  server.on("close", () => {
    clearInterval(continuityTimer);
    if (ownsStore) store.close();
  });

  return { server, store, continuitySince };
}

export function monitorSummary(item) {
  return `${item.id.padEnd(24)} ${item.state.padEnd(10)} every ${formatDuration(item.intervalMs)}`;
}
