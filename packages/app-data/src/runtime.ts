/**
 * Runtime bootstrap — mint the WyStack client once and expose its Provider.
 *
 * `createWyStack` must be called exactly once at startup (per-render minting
 * wipes the query cache), but the server URL is only known at runtime — the
 * Electron loopback port arrives via IPC, the web origin from `location`/env.
 * So each host resolves its URL, calls this once before rendering, and feeds
 * the returned `Provider` into the shared app's `providerWrapper` slot.
 *
 * Side effect: also wires the imperative-getter singleton (`setWyStackClient`)
 * so non-React data access (`getDashboard`, CSV ingest, …) reaches the same
 * client. One call, both seams satisfied.
 */
import { createWyStack } from "@wystack/client";
import type { FC, ReactNode } from "react";

import type { Functions } from "@dashframe/server/functions";

import { setWyStackClient } from "./client";

export interface WyStackRuntime {
  /** Wraps children in QueryClientProvider + WyStackProvider (client bound). */
  Provider: FC<{ children: ReactNode }>;
}

export interface WyStackRuntimeConfig {
  url: string;
  token?: string;
}

/**
 * Mint the client for `config`, wire the imperative singleton, and return the
 * bound Provider. Call once per host, before rendering.
 */
export function createWyStackRuntime(
  config: string | WyStackRuntimeConfig,
): WyStackRuntime {
  const runtimeConfig = typeof config === "string" ? { url: config } : config;
  const token = runtimeConfig.token;
  const instance = createWyStack<Functions>({
    url: runtimeConfig.url,
    getToken: token ? () => token : undefined,
  });
  setWyStackClient(instance.client);
  return { Provider: instance.Provider };
}

/**
 * Resolve the WyStack server connection for the current surface, in priority order:
 *   1. Electron loopback — `window.dashframe.getServerInfo()` (async IPC).
 *   2. Web dev proxy — `VITE_WYSTACK_URL` configures Vite's `/api` proxy, but
 *      the browser still talks same-origin to preserve COOP/COEP behavior.
 *   3. Explicit production override — `VITE_WYSTACK_URL`.
 *   4. Same-origin — the page's own origin (web app served by the server).
 *
 * Async because the Electron branch awaits IPC; the others resolve immediately.
 */
export async function resolveWyStackConfig(): Promise<WyStackRuntimeConfig> {
  // The Electron IPC contract (`@dashframe/desktop-types` ServerInfo) guarantees
  // `token` is always present on the desktop surface — type it as required here
  // rather than widening to the optional `WyStackRuntimeConfig`, so a silent
  // token-drop (version skew, IPC regression) fails closed instead of producing
  // an unauthenticated client. app-data also serves the web surface, so we
  // mirror the contract locally instead of depending on the Electron package.
  const desktop = (
    globalThis as {
      dashframe?: { getServerInfo(): Promise<{ url: string; token: string }> };
    }
  ).dashframe;
  if (desktop) {
    const info = await desktop.getServerInfo();
    if (!info.token) {
      throw new Error(
        "Desktop getServerInfo returned no loopback token — refusing to start an unauthenticated client.",
      );
    }
    return info;
  }

  const override = import.meta.env?.VITE_WYSTACK_URL;
  if (override && import.meta.env?.DEV) {
    return { url: globalThis.location.origin };
  }
  if (override) return { url: override };

  return { url: globalThis.location.origin };
}
