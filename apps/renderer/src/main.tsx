import "@dashframe/app/globals.css";

import type { AppRouterContext, ProviderWrapper } from "@dashframe/app";
import { createWyStackRuntime, resolveWyStackConfig } from "@dashframe/core";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

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
// and inject the WyStack Provider through the shared app's providerWrapper slot
// — the same channel the web host uses for PostHog. The renderer has no
// analytics, so the Provider is the whole wrapper here.
async function bootstrap() {
  const config = await resolveWyStackConfig();
  const { Provider } = createWyStackRuntime(config);
  const providerWrapper: ProviderWrapper = ({ children }) => (
    <Provider>{children}</Provider>
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
