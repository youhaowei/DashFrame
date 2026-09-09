import {
  FLECHETTE_DECODE_OPTIONS,
  frameTableName,
  quoteIdentifier,
} from "@dashframe/engine";
import { tableFromIPC } from "@uwdata/flechette";

import type { MosaicConnector } from "./VisualizationProvider";

const TIMEOUT_MS = 10_000;
const FRAME_ID =
  /"([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"/gi;

export interface ServerFrameConnectorOptions {
  serverUrl: string;
  token?: string;
}

/**
 * Mosaic-only connector for immutable server DataFrames.
 *
 * Charts name their source by DataFrame UUID, so the SQL Mosaic composes arrives
 * here quoting that UUID. This connector resolves the frame the query is about,
 * addresses the server route by that id, and emits SQL that references the
 * frame's canonical table name — `frameTableName(id)`, the one name a frame is
 * registered under — directly.
 *
 * The naming is done HERE rather than on the server on purpose. The server used
 * to require the SQL to mention the quoted UUID and then substitute the table
 * name in, which read like a guard but was not one: any other table named in the
 * same statement ran as written. Isolation between principals is by engine
 * instance, not by reading SQL, so the substitution is naming work and belongs
 * on the side that composes the statement. The client is not a trust boundary
 * and this code claims no security property.
 *
 * No renderer upload, registration, or provider identity crosses this boundary.
 */
export function createServerFrameConnector(
  options: ServerFrameConnectorOptions,
): MosaicConnector {
  const headers = {
    "Content-Type": "application/json",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };

  async function query(query: {
    type?: "arrow" | "exec" | "json";
    sql: string;
  }): Promise<unknown> {
    const type = query.type ?? "arrow";
    const frameIds = [...query.sql.matchAll(FRAME_ID)].map(
      (match) => match[1]!,
    );
    const frameId = frameIds[0];
    if (!frameId || frameIds.some((id) => id !== frameId)) {
      throw new Error(
        "Chart query must reference exactly one server DataFrame",
      );
    }
    // Every occurrence matched the same id, so a plain split/join rewrites them
    // all. `FRAME_ID` matched the quoted form, so this replaces `"<uuid>"` with
    // the quoted canonical table name and cannot touch anything else.
    const sql = query.sql
      .split(`"${frameId}"`)
      .join(quoteIdentifier(frameTableName(frameId)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(
        `${options.serverUrl}/data/frames/${encodeURIComponent(frameId)}/mosaic`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ type, sql }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Chart query failed (${response.status})`);
      }
      if (type === "exec") return;
      if (type === "json")
        return (await response.json()) as Record<string, unknown>[];
      return tableFromIPC(
        new Uint8Array(await response.arrayBuffer()),
        FLECHETTE_DECODE_OPTIONS,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Chart query timed out", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return { query } as MosaicConnector;
}
