/**
 * Renderer-side WyStack client.
 *
 * The renderer is a localhost web client of the loopback WyStack server the
 * Electron main process starts (Data Path & Transport Deployment spec). It
 * imports only the *type* of the server's function registry — the tRPC pattern,
 * runtime erased — so no server code reaches the renderer bundle.
 *
 * `createWyStack` must be called exactly once at module scope (calling it per
 * render mints a fresh client and wipes the query cache). But the loopback URL
 * is only known after main binds its ephemeral port, so we resolve it via IPC
 * first and mint the client inside an async bootstrap, before React renders.
 *
 * No auth: the loopback token mechanism is an open spec decision and out of
 * scope for the v0.2 integration smoke (YW-69).
 */
import type { Functions } from "@dashframe/server/functions";
import { createWyStack, type WyStackInstance } from "@wystack/client";

export type DashframeApi = WyStackInstance<Functions>;

/**
 * Resolve the loopback URL from main, then mint the client once. Call before
 * rendering; pass the result down through React.
 */
export async function createDashframeClient(): Promise<DashframeApi> {
  const { url } = await window.dashframe.getServerInfo();
  return createWyStack<Functions>({ url });
}
