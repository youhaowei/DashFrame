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
  /** Browser host access changed; the entrypoint owns revalidation and teardown. */
  onAccessInvalidated?: (reason: "denied" | "unavailable") => void;
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
  let closed = false;
  const invalidateAccess = (reason: "denied" | "unavailable") => {
    if (!closed) config.onAccessInvalidated?.(reason);
  };

  async function fetchAccessToken(): Promise<string | null> {
    try {
      const response = await fetch(new URL("/api/convex-token", config.url), {
        method: "POST",
        headers: hostHeaders(config),
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) {
        invalidateAccess(
          response.status === 401 || response.status === 403
            ? "denied"
            : "unavailable",
        );
        return null;
      }
      if (
        config.onAccessInvalidated &&
        response.headers.get("content-type")?.split(";")[0]?.trim() !==
          "application/json"
      ) {
        invalidateAccess("unavailable");
        return null;
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("token" in body) ||
        typeof body.token !== "string" ||
        !body.token.trim() ||
        (config.onAccessInvalidated &&
          (!("expiresAt" in body) ||
            typeof body.expiresAt !== "number" ||
            !Number.isFinite(body.expiresAt) ||
            body.expiresAt <= Date.now()))
      ) {
        invalidateAccess("unavailable");
        return null;
      }
      return closed ? null : body.token;
    } catch {
      // Convex needs null to leave AuthLoading and show Unauthenticated. A thrown
      // token fetch leaves the client waiting indefinitely after a host failure.
      invalidateAccess("unavailable");
      return null;
    }
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
      closed = true;
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
  if (!desktop)
    throw new Error(
      "Browser startup must resolve access before creating a runtime",
    );
  const config = await desktop.getServerInfo();
  if (!config.token)
    throw new Error("Desktop getServerInfo returned no loopback token");
  return {
    ...config,
    convexUrl: new URL("/api/convex", config.url).toString(),
  };
}
