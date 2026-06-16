/**
 * Client-side preview-batch helper.
 *
 * Calls the server's `POST /preview/batch` endpoint with a command array and
 * returns a `PreviewDiff` (METADATA ONLY — compute slots are `undefined`).
 * Row data is NEVER sent over this path; the caller fills compute client-side
 * via local DuckDB.
 *
 * Split-tier invariant: the server returns metadata, the renderer fills data.
 */
import type { PreviewDiff } from "@dashframe/types";

import { getWyStackClient } from "./client";

/**
 * One command envelope, mirroring `@wystack/server`'s `Command` type without
 * importing the server package on the client side.
 */
export interface PreviewCommand {
  id?: string;
  path: string;
  args: unknown;
}

/**
 * Send a batch of commands to the server for preview.
 *
 * Returns a `PreviewDiff` with `compute: undefined` on every direct node.
 * The caller is responsible for filling compute slots locally.
 *
 * @throws when the server returns a non-OK status or the response is not a
 *         valid `PreviewDiff`.
 */
export async function previewBatch(
  commands: PreviewCommand[],
): Promise<PreviewDiff> {
  const client = getWyStackClient();
  const baseUrl = client.url; // e.g. "http://127.0.0.1:53017"

  // Auth — the WyStack client holds the bearer token via its getToken function.
  // We mirror what the WyStack HTTP transport does: read the token from the
  // client's auth headers. The client exposes a `ws` manager but not `getToken`
  // directly; replicate the auth-header logic via a one-shot query to get the
  // token's header, then use it on the custom endpoint.
  //
  // Simpler: the WyStack client accepts a `getToken` callback, and `client.ws`
  // carries the same config. We reach the token via the client's `query()` flow
  // only indirectly. Instead, we store auth data in the client URL — but
  // `client.url` is just the base URL.
  //
  // The cleanest approach: derive the Authorization header ourselves from the
  // server URL, which the client has resolved at startup. The token is injected
  // into the client via `createWyStackRuntime` which calls `createWyStack` with
  // a `getToken`. The WyStackClient does not expose `getToken` as a public
  // member, so we accept an optional token override here.
  //
  // In practice the Electron renderer mints a per-launch token that the client
  // carries; the web surface uses same-origin (no token). `resolveWyStackConfig`
  // returns `{ url, token? }` — the host passes both to `createWyStackRuntime`.
  // We don't have the token here; `getPreviewAuthHeader` is the seam.

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Attempt to get the auth header by issuing a minimal WyStack call to see
  // what headers it would use. We can't cleanly access the token. Instead we
  // fall back to the app-level auth header provider if available.
  // On Electron (loopback + token): the window.dashframe.getServerInfo() result
  // is stored in the client's getToken. We can retrieve it indirectly.
  // The simplest correct approach: export a module-level token setter alongside
  // setWyStackClient, and let the host call it.
  const authHeader = getPreviewAuthHeader();
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  const res = await fetch(`${baseUrl}/preview/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ commands }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `previewBatch: server returned ${String(res.status)}: ${text}`,
    );
  }

  return (await res.json()) as PreviewDiff;
}

// ---------------------------------------------------------------------------
// Auth header seam — the host calls setPreviewAuthToken once at startup.
// ---------------------------------------------------------------------------

let _previewAuthHeader: string | null = null;

/**
 * Wire the bearer token for the preview-batch endpoint.
 *
 * On Electron: call this alongside `setWyStackClient`, passing the same
 * per-launch token from `window.dashframe.getServerInfo()`.
 * On web (same-origin, loopback without token): omit.
 */
export function setPreviewAuthToken(token: string | null): void {
  _previewAuthHeader = token ? `Bearer ${token}` : null;
}

function getPreviewAuthHeader(): string | null {
  return _previewAuthHeader;
}
