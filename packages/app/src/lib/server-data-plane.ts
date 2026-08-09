import { tableFromIPC } from "apache-arrow";

import type { ServerMosaicConnector } from "./server-connector";

const TIMEOUT_MS = 10_000;

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Server data plane timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerDuckDBConnection {
  query(sql: string): Promise<ReturnType<typeof tableFromIPC>>;
  insertArrowFromIPCStream(
    arrow: Uint8Array,
    options: { name: string },
  ): Promise<void>;
  registerServerFrame(frameId: string, tableName: string): Promise<void>;
  close(): Promise<void>;
}

let activeConnection: ServerDuckDBConnection | null = null;

export function configureServerDataPlane(options: {
  serverUrl: string;
  token?: string;
  connector: ServerMosaicConnector;
}): ServerDuckDBConnection {
  const authHeaders = (contentType: string) => ({
    "Content-Type": contentType,
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  });
  activeConnection = {
    async query(sql) {
      const response = await request(`${options.serverUrl}/data/arrow`, {
        method: "POST",
        headers: authHeaders("application/json"),
        body: JSON.stringify({ sql }),
      });
      if (!response.ok) {
        throw new Error(
          `Server query failed (${response.status}): ${await response.text()}`,
        );
      }
      return tableFromIPC(new Uint8Array(await response.arrayBuffer()));
    },
    async insertArrowFromIPCStream(arrow, { name }) {
      const response = await request(
        `${options.serverUrl}/data/tables/${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: authHeaders("application/vnd.apache.arrow.stream"),
          body: arrow,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Server table upload failed (${response.status}): ${await response.text()}`,
        );
      }
    },
    registerServerFrame: (frameId, tableName) =>
      options.connector.registerServerFrame(frameId, tableName),
    async close() {},
  };
  return activeConnection;
}

export function getServerDataPlane(): ServerDuckDBConnection | null {
  return activeConnection;
}
