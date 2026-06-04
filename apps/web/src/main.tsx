import "@dashframe/app/globals.css";

import type { AppRouterContext, ProviderWrapper } from "@dashframe/app";
import { createWyStackRuntime, resolveWyStackUrl } from "@dashframe/core";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import { WebProviders } from "./web-providers";

// Router at module scope (registers `typeof router`); runtime context injected
// after the async URL resolve. On web the URL is same-origin (or
// VITE_WYSTACK_URL), so the resolve is effectively synchronous — but we keep
// the async shape for parity with the Electron host's IPC handshake.
const router = createRouter({
  routeTree,
  context: {} as AppRouterContext,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

async function bootstrap() {
  const url = await resolveWyStackUrl();
  const { Provider } = createWyStackRuntime(url);

  // WyStack Provider wraps PostHog so every data hook (and PostHogPageView's
  // router hooks) sees both contexts. The composed wrapper rides the
  // providerWrapper slot into the shared RouteRoot.
  const providerWrapper: ProviderWrapper = ({ children }) => (
    <Provider>
      <WebProviders>{children}</WebProviders>
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

void bootstrap();
