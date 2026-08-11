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
 * Charts name their source by DataFrame UUID. The server resolves that UUID to
 * its native table and executes the Mosaic-generated query; no renderer upload,
 * registration, or provider identity crosses this boundary.
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(
        `${options.serverUrl}/data/frames/${encodeURIComponent(frameId)}/mosaic`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ type, sql: query.sql }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Chart query failed (${response.status})`);
      }
      if (type === "exec") return;
      if (type === "json")
        return (await response.json()) as Record<string, unknown>[];
      return tableFromIPC(new Uint8Array(await response.arrayBuffer()), {
        useDate: true,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Chart query timed out");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return { query } as MosaicConnector;
}
