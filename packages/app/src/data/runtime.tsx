import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Authenticated,
  AuthLoading,
  ConvexProviderWithAuth,
  ConvexReactClient,
  Unauthenticated,
} from "convex/react";
import { useCallback, type FC, type ReactNode } from "react";

export interface AppRuntimeConfig {
  url: string;
  token?: string;
  convexUrl?: string;
}

export interface AppRuntime {
  Provider: FC<{ children: ReactNode }>;
  close(): Promise<void>;
}

let runtimeConfig: AppRuntimeConfig | null = null;
let convexClient: ConvexReactClient | null = null;

export function getRuntimeConfig(): AppRuntimeConfig {
  if (!runtimeConfig) throw new Error("DashFrame runtime has not started");
  return runtimeConfig;
}

/** Imperative imports and loaders share the renderer's native Convex client. */
export function getConvexClient(): ConvexReactClient {
  if (!convexClient) throw new Error("DashFrame Convex client has not started");
  return convexClient;
}

export function hostHeaders(config: AppRuntimeConfig): HeadersInit {
  return config.token ? { Authorization: `Bearer ${config.token}` } : {};
}

export function createAppRuntime(config: AppRuntimeConfig): AppRuntime {
  if (!config.convexUrl) throw new Error("Host did not provide a Convex URL");
  runtimeConfig = config;
  const client = new ConvexReactClient(config.convexUrl);
  convexClient = client;
  const queryClient = new QueryClient();

  async function fetchAccessToken() {
    const response = await fetch(new URL("/api/convex-token", config.url), {
      method: "POST",
      headers: hostHeaders(config),
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error("Could not authenticate with the DashFrame host");
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("token" in body) ||
      typeof body.token !== "string" ||
      !body.token
    ) {
      throw new Error("Host returned an invalid Convex token");
    }
    return body.token;
  }

  function useHostAuth() {
    // Convex owns token refresh and calls this again before the JWT expires.
    const fetchToken = useCallback(fetchAccessToken, []);
    return {
      isLoading: false,
      isAuthenticated: true,
      fetchAccessToken: fetchToken,
    };
  }

  const Provider: AppRuntime["Provider"] = ({ children }) => (
    <ConvexProviderWithAuth client={client} useAuth={useHostAuth}>
      <AuthLoading>
        <div role="status" className="p-6 text-sm">
          Connecting to DashFrame…
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div role="alert" className="p-6 text-sm">
          Could not connect to DashFrame. Reload to try again.
        </div>
      </Unauthenticated>
      <Authenticated>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </Authenticated>
    </ConvexProviderWithAuth>
  );
  return {
    Provider,
    async close() {
      queryClient.clear();
      await client.close();
      if (convexClient === client) {
        convexClient = null;
        runtimeConfig = null;
      }
    },
  };
}

export async function resolveAppConfig(): Promise<AppRuntimeConfig> {
  const desktop = (
    globalThis as {
      dashframe?: {
        getServerInfo(): Promise<{
          url: string;
          token: string;
          convexUrl?: string;
        }>;
      };
    }
  ).dashframe;
  let config: AppRuntimeConfig;
  if (desktop) {
    config = await desktop.getServerInfo();
    if (!config.token)
      throw new Error("Desktop getServerInfo returned no loopback token");
  } else {
    const override = import.meta.env?.VITE_DASHFRAME_URL;
    config = {
      url:
        override && !import.meta.env?.DEV
          ? override
          : globalThis.location.origin,
    };
  }
  if (config.convexUrl) return config;
  const response = await fetch(new URL("/api/runtime", config.url), {
    headers: hostHeaders(config),
  });
  if (!response.ok)
    throw new Error("Could not load the DashFrame runtime configuration");
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("convexUrl" in body) ||
    typeof body.convexUrl !== "string"
  ) {
    throw new Error("Host did not provide a Convex URL");
  }
  return {
    ...config,
    convexUrl: desktop
      ? body.convexUrl
      : new URL("/api/convex", config.url).toString(),
  };
}
