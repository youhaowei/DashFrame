/**
 * Live-client singleton for non-React (imperative) data access.
 *
 * React components reach the WyStack client through context (the host's
 * `WyStackProvider` + `useWyStackClient`). But the app also has plain async
 * helpers — CSV ingest and pagination loaders — that call the RPC client
 * outside any component. Those need the
 * same minted client, and the client's URL is only known at runtime.
 *
 * So the host calls `setWyStackClient(instance.client)` exactly once, right
 * after `createWyStack`, before rendering. The helpers read it via
 * `getWyStackClient()`. Calling a helper before the host wires the client is a
 * programming error and throws loudly rather than silently returning empty.
 */
import type { WyStackClient } from "@wystack/client";

let _client: WyStackClient | null = null;

/** Host wires the minted client once, before rendering. */
export function setWyStackClient(client: WyStackClient): void {
  _client = client;
}

/** Imperative getters read the live client here. Throws if not yet wired. */
export function getWyStackClient(): WyStackClient {
  if (!_client) {
    throw new Error(
      "WyStack client not set — call setWyStackClient(instance.client) before using imperative getters",
    );
  }
  return _client;
}
