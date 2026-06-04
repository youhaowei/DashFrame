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

/**
 * Mint the client for `url`, wire the imperative singleton, and return the
 * bound Provider. Call once per host, before rendering.
 */
export function createWyStackRuntime(url: string): WyStackRuntime {
  const instance = createWyStack<Functions>({ url });
  setWyStackClient(instance.client);
  return { Provider: instance.Provider };
}

/**
 * Resolve the WyStack server URL for the current surface, in priority order:
 *   1. Electron loopback — `window.dashframe.getServerInfo()` (async IPC).
 *   2. Web dev proxy — `VITE_WYSTACK_URL` configures Vite's `/api` proxy, but
 *      the browser still talks same-origin to preserve COOP/COEP behavior.
 *   3. Explicit production override — `VITE_WYSTACK_URL`.
 *   4. Same-origin — the page's own origin (web app served by the server).
 *
 * Async because the Electron branch awaits IPC; the others resolve immediately.
 */
export async function resolveWyStackUrl(): Promise<string> {
  const desktop = (
    globalThis as { dashframe?: { getServerInfo(): Promise<{ url: string }> } }
  ).dashframe;
  if (desktop) {
    const { url } = await desktop.getServerInfo();
    return url;
  }

  const override = import.meta.env?.VITE_WYSTACK_URL;
  if (override && import.meta.env?.DEV) return globalThis.location.origin;
  if (override) return override;

  return globalThis.location.origin;
}
