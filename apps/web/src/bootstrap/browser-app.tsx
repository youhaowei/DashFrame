import {
  ChartEngineProvider,
  createAppRuntime,
  type AppRouterContext,
  type HostRuntimeConfig,
  type ProviderWrapper,
} from "@dashframe/app";
import { createServerFrameConnector } from "@dashframe/visualization";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { routeTree } from "../routeTree.gen";
import { WebProviders } from "../web-providers";

function createBrowserRouter() {
  return createRouter({ routeTree, context: {} as AppRouterContext });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createBrowserRouter>;
  }
}

/** Called only after the transport has resolved an explicitly ready state. */
export async function createBrowserApp(
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
    const router = createBrowserRouter();
    const connector = createServerFrameConnector({ serverUrl: config.url });
    const Provider = runtime.Provider;
    const providerWrapper: ProviderWrapper = ({ children }) => (
      <Provider>
        <ChartEngineProvider connector={connector}>
          <WebProviders>{children}</WebProviders>
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
