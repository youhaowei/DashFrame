import "@dashframe/app/globals.css";

import type { AppRouterContext } from "@dashframe/app";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import { WebProviders } from "./web-providers";

const context: AppRouterContext = { providerWrapper: WebProviders };

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
