/**
 * Client-side preview-diff helper.
 *
 * Calls the server's `previewDiff` WyStack query with a command batch and
 * returns a `PreviewDiff` (METADATA ONLY — compute slots are `undefined`).
 * Row data is NEVER sent over this path; the caller fills compute slots
 * client-side via local DuckDB.
 *
 * Split-tier invariant: the server returns metadata, the renderer fills data.
 */
import type { PreviewDiff } from "@dashframe/types";

import { api } from "./api";
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
 * Send a batch of commands to the server for preview via the WyStack RPC layer.
 *
 * Returns a `PreviewDiff` with `compute: undefined` on every direct node.
 * The caller is responsible for filling compute slots locally.
 *
 * Auth is handled transparently by the WyStack client — no separate token
 * management required.
 *
 * @throws when the RPC call fails or the response is not a valid `PreviewDiff`.
 */
export async function previewBatch(
  commands: PreviewCommand[],
): Promise<PreviewDiff> {
  return getWyStackClient().query(api.previewDiff, { commands });
}
