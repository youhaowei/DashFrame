import type { AppRouterContext, ProviderWrapper } from "@dashframe/app";
import {
  ChartEngineProvider,
  createAppRuntime,
  type HostRuntimeConfig,
} from "@dashframe/app";
import { createServerFrameConnector } from "@dashframe/visualization";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { routeTree } from "../routeTree.gen";
import { createRendererHistory } from "../renderer-history";

function createDesktopRouter() {
  return createRouter({
    routeTree,
    history: createRendererHistory(),
    context: {} as AppRouterContext,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createDesktopRouter>;
  }
}

/** Called only after the transport has resolved an explicitly ready state. */
export async function createDesktopApp(
  config: HostRuntimeConfig,
  onAccessInvalidated: (reason: "denied" | "unavailable") => void,
) {
  let closed = false;
  const runtime = createAppRuntime({
    ...config,
    onAccessInvalidated: (reason) => {
      if (!closed) onAccessInvalidated(reason);
    },
  });
  try {
    const router = createDesktopRouter();
    // Desktop charts use the same server-frame Mosaic connector as web; the
    // shared tree receives no Electron-specific data-plane injection.
    const connector = createServerFrameConnector({
      serverUrl: config.url,
      ...(config.token ? { token: config.token } : undefined),
    });
    const Provider = runtime.Provider;
    const providerWrapper: ProviderWrapper = ({ children }) => (
      <Provider>
        <ChartEngineProvider connector={connector}>
          {children}
        </ChartEngineProvider>
      </Provider>
    );
    router.update({ context: { providerWrapper } });
    return {
      element: <RouterProvider router={router} />,
      async close() {
        closed = true;
        await runtime.close();
      },
    };
  } catch (error) {
    closed = true;
    await runtime.close();
    throw error;
  }
}
