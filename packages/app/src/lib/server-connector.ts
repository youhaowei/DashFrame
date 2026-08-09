import { tableFromIPC } from "@uwdata/flechette";

import type { MosaicConnector } from "../components/providers/ChartEngineProvider";

const TIMEOUT_MS = 10_000;

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerMosaicConnector extends MosaicConnector {
  registerServerFrame(frameId: string, tableName: string): Promise<void>;
}

/** Native server connector shared by web and Electron. */
export function createServerConnector(options: {
  serverUrl: string;
  token?: string;
}): ServerMosaicConnector {
  const headers = (contentType: string): Record<string, string> => ({
    "Content-Type": contentType,
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  });

  async function query(q: { type?: string; sql: string }): Promise<unknown> {
    const type = q.type ?? "arrow";
    const response = await request(`${options.serverUrl}/data/arrow`, {
      method: "POST",
      headers: headers("application/json"),
      body: JSON.stringify({ type, sql: q.sql }),
    });
    if (!response.ok) {
      throw new Error(
        `Server query failed (${response.status}): ${await response.text()}`,
      );
    }
    if (type === "exec") return undefined;
    if (type === "json") {
      return (await response.json()) as Record<string, unknown>[];
    }
    return tableFromIPC(new Uint8Array(await response.arrayBuffer()), {
      useDate: true,
    });
  }

  async function registerServerFrame(
    frameId: string,
    tableName: string,
  ): Promise<void> {
    const endpoint = `${options.serverUrl}/data/frames/${encodeURIComponent(frameId)}/tables/${encodeURIComponent(tableName)}`;
    const response = await request(endpoint, {
      method: "POST",
      headers: headers("application/json"),
    });
    if (!response.ok) {
      throw new Error(
        `Server frame registration failed (${response.status}): ${await response.text()}`,
      );
    }
  }

  return { query, registerServerFrame } as ServerMosaicConnector;
}
