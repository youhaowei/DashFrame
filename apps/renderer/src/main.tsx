import "@dashframe/app/globals.css";

import type { AppRouterContext, ProviderWrapper } from "@dashframe/app";
import { ChartEngineProvider } from "@dashframe/app";
import { createWyStackRuntime, resolveWyStackConfig } from "@dashframe/core";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createNativeConnector } from "./nativeConnector";
import { routeTree } from "./routeTree.gen";

// Router is created at module scope (so `typeof router` registers the type),
// with an empty context. The runtime context — the WyStack Provider wrapper —
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

// The renderer is a localhost client of the loopback WyStack server the
// Electron main process starts. Resolve its URL via IPC, mint the client once,
// and inject the WyStack Provider through the shared app's providerWrapper slot.
//
// Desktop chart compute: the native DuckDB engine sits behind the loopback
// server's Arrow IPC endpoint (`POST /data/arrow`). We build a Mosaic Connector
// that routes chart queries there and inject it via ChartEngineProvider — no
// `isElectron` branching in the shared app components. VisualizationSetup reads
// the connector from context; when present it bypasses DuckDB-WASM.
async function bootstrap() {
  const config = await resolveWyStackConfig();
  const { Provider } = createWyStackRuntime(config);

  // Attempt to build a native connector via the Electron IPC bridge.
  // `window.dashframe` is only present in the Electron renderer (contextBridge).
  // In web tier / tests this will be undefined — safe to ignore.
  let nativeConnector: ReturnType<typeof createNativeConnector> | null = null;
  let engineError: string | null = null;

  const desktop = (
    globalThis as {
      dashframe?: { getServerInfo(): Promise<{ url: string; token: string }> };
    }
  ).dashframe;
  if (desktop?.getServerInfo) {
    try {
      const info = await desktop.getServerInfo();
      if (info?.url && info?.token) {
        nativeConnector = createNativeConnector({
          serverUrl: info.url,
          token: info.token,
        });
      } else {
        engineError = "Native engine not available — server info missing.";
      }
    } catch (err) {
      // Failed to reach the loopback server; charts will show a degraded banner.
      engineError =
        err instanceof Error
          ? `Native engine unavailable: ${err.message}`
          : "Native engine unavailable — unknown error.";
      console.error("[DashFrame] Failed to build native connector:", err);
    }
  }

  // Bind the upload callback ONCE here, not inside the providerWrapper body.
  // providerWrapper is rendered as a React component, so any object/function
  // created in its body would be a fresh reference every render. That fresh
  // reference flows through ChartEngineProvider context into useInsightView's
  // chart-query effect dependency array, re-firing the effect on every render
  // (→ setState → re-render → infinite loop, which crashes the renderer on the
  // visualization route). A stable, module-lifetime callback breaks the loop.
  const uploadArrowTable = nativeConnector
    ? (name: string, arrowBytes: Uint8Array) =>
        nativeConnector.uploadArrowTable(name, arrowBytes)
    : null;

  const providerWrapper: ProviderWrapper = ({ children }) => (
    <Provider>
      <ChartEngineProvider
        connector={nativeConnector}
        engineError={engineError}
        uploadArrowTable={uploadArrowTable}
      >
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
// → 0). Catch them here: log and swallow. The VisualizationBoundary in
// VisualizationSetup catches render-phase throws from the same cause; this
// handles the async side of the same failure mode.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg =
    reason instanceof Error ? reason.message : String(reason ?? "unknown");
  // Only intercept rejections that look like engine/loopback failures so we
  // don't silence unrelated bugs. Loopback errors include "Native engine",
  // "fetch", "AbortError", "Failed to fetch", and HTTP status codes.
  const isEngineLoss =
    /native engine|loopback|fetch|abort|network|econnrefused|econnreset|etimedout/i.test(
      msg,
    );
  if (isEngineLoss) {
    console.warn(
      "[DashFrame] Swallowed unhandled rejection (engine loss):",
      reason,
    );
    event.preventDefault();
  }
});
