import "@dashframe/app/globals.css";

import { HostedAccessScreen } from "@/components/hosted-access/HostedAccessScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { startHostSession } from "@dashframe/app";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import { createDesktopApp } from "./bootstrap/desktop-app";
import { resolveDesktopHost } from "./bootstrap/desktop-host";
import { isServerFrameEngineLoss } from "./server-frame-engine-loss";

function renderBootstrapError(error: unknown) {
  console.error("Failed to start DashFrame renderer", error);
  const container = document.getElementById("root");
  if (!container) return;

  createRoot(container).render(
    <div role="alert" className="p-6 text-sm text-red-700">
      DashFrame failed to start. Check the local server connection and reload.
    </div>,
  );
}

// The renderer is a client of whichever host it is pointed at. Today the
// Electron main process resolves that host over IPC — the loopback server it
// started, with the per-launch bearer token that authenticates against it — but
// the access state machine below is the same one the browser client runs, so a
// remote host answering "signed-out" or "pending" renders the same screens.
async function bootstrap() {
  const { url, token } = await resolveDesktopHost(window.dashframe);

  const container = document.getElementById("root");
  if (!container) throw new Error("Root container #root not found");
  const root = createRoot(container);

  // startHostSession owns its own pagehide teardown; do not double-register.
  startHostSession({
    hostUrl: url,
    token,
    createRuntime: createDesktopApp,
    publish(view) {
      const content =
        view.status === "local-ready" || view.status === "admitted" ? (
          view.runtime.element
        ) : (
          <ThemeProvider>
            <HostedAccessScreen {...view} />
          </ThemeProvider>
        );
      // Flush provider cleanup before the controller closes its Convex client.
      flushSync(() => root.render(<StrictMode>{content}</StrictMode>));
    },
    unmount: () => root.unmount(),
  });
}

bootstrap().catch(renderBootstrapError);

// ── Fail-soft: mid-session engine loss ──────────────────────────────────────
// When the native DuckDB engine stops mid-session, pending Mosaic/vgplot fetch
// calls reject with a network or timeout error. These Promise rejections can
// escape through mosaic-core internals (Coordinator's internal promise chains
// have no outer catch) and surface as unhandledrejection events. In Electron,
// an unhandled rejection in the renderer process kills the page (CDP page count
// → 0). Catch them here: log and swallow engine-loss rejections only.
// Pattern matches the server-frame connector strings so we never
// silence unrelated bugs (see the regex comment below).
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg =
    reason instanceof Error ? reason.message : String(reason ?? "unknown");
  // Intercept only rejections that are clearly from the loopback engine path.
  // The patterns cover server-frame connector failures:
  //   "Chart query timed out" → aborted server-frame query
  //   "Chart query failed"    → non-OK server-frame response
  //   "Failed to fetch"            → browser network error (ECONNREFUSED) when
  //      the loopback server stops mid-session. This is generic, but on desktop
  //      the only in-session cross-origin fetch is to the loopback engine —
  //      there is no cloud/analytics network call in the Electron renderer.
  //      Accept this narrow false-positive risk: swallowing a genuine "Failed
  //      to fetch" from another source on the DESKTOP path is very low risk;
  //      failing to swallow a loopback engine-loss rejection crashes the renderer.
  const isEngineLoss = isServerFrameEngineLoss(msg);
  if (isEngineLoss) {
    console.warn(
      "[DashFrame] Swallowed unhandled rejection (engine loss):",
      reason,
    );
    event.preventDefault();
  }
});
