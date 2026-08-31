import "@dashframe/app/globals.css";

import type { AppRouterContext, ProviderWrapper } from "@dashframe/app";
import {
  ChartEngineProvider,
  createAppRuntime,
  resolveAppConfig,
} from "@dashframe/app";
import { createServerFrameConnector } from "@dashframe/visualization";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import { isServerFrameEngineLoss } from "./server-frame-engine-loss";

// Router is created at module scope (so `typeof router` registers the type),
// with an empty context. The runtime context — the Convex Provider wrapper —
// is injected after the async URL handshake, via router.update(), before the
// first render.
const router = createRouter({
  routeTree,
  context: {} as AppRouterContext,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

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

// The renderer is a localhost client of the loopback host server the
// Electron main process starts. Resolve its URL via IPC, mint the client once,
// and inject the Convex Provider through the shared app's providerWrapper slot.
//
// Desktop charts use the same server-frame Mosaic connector as web. The shared
// tree receives no Electron-specific data-plane injection.
async function bootstrap() {
  const config = await resolveAppConfig();
  const { Provider, close } = createAppRuntime(config);
  window.addEventListener(
    "pagehide",
    () => {
      close();
    },
    { once: true },
  );

  if (!config.token) {
    throw new Error(
      "Desktop server info omitted its loopback token; server frame access unavailable",
    );
  }
  const connector = createServerFrameConnector({
    serverUrl: config.url,
    token: config.token,
  });

  const providerWrapper: ProviderWrapper = ({ children }) => (
    <Provider>
      <ChartEngineProvider connector={connector}>
        {children}
      </ChartEngineProvider>
    </Provider>
  );

  router.update({ context: { providerWrapper } });

  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root container #root not found");
  }

  createRoot(container).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
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
