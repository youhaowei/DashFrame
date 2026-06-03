import "@dashframe/app/globals.css";

import type { AppRouterContext } from "@dashframe/app";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";

// Phase 1: the renderer mounts the shared @dashframe/app on the Dexie/IndexedDB
// stack — same full app as the web host, no WyStack server. The web-only
// provider wrapper (PostHog) is omitted; the renderer injects nothing
// (pass-through). The WyStack client + loopback URL seam arrives in Phase 2.
const context: AppRouterContext = {};

const router = createRouter({ routeTree, context });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
