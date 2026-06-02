import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import { createDashframeClient, type DashframeApi } from "./wystack";

export interface RouterContext {
  api: DashframeApi["api"];
}

const router = createRouter({
  routeTree,
  context: { api: undefined! } as RouterContext,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found");
}

// Async bootstrap: resolve the loopback URL + mint the WyStack client once
// (createWyStack is module-scope-only), then render inside its Provider.
async function bootstrap(): Promise<void> {
  const { Provider, api } = await createDashframeClient();

  createRoot(container!).render(
    <StrictMode>
      <Provider>
        <RouterProvider router={router} context={{ api }} />
      </Provider>
    </StrictMode>,
  );
}

bootstrap().catch((err: unknown) => {
  console.error("[dashframe] renderer bootstrap failed:", err);
});
