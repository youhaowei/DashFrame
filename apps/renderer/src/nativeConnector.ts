/**
 * Native engine Mosaic Connector for the desktop renderer.
 *
 * Builds a Mosaic Connector that routes all chart-compute queries to the
 * native DuckDB engine via the loopback Arrow IPC endpoint (`POST /data/arrow`).
 *
 * This is the desktop-tier half of the surface-scoped engine selection:
 *   - Desktop:  this connector → loopback server → native DuckDB
 *   - Web/WASM: no connector; VisualizationSetup falls back to DuckDB-WASM
 *
 * No `isElectron` checks in components — the connector is injected through
 * ChartEngineProvider by the renderer's bootstrap (main.tsx) only when the
 * desktop IPC surface is present.
 *
 * ## Table upload
 *
 * Before chart queries can run against a DataFrame table, that table must be
 * uploaded to the native engine's in-memory store via `POST /data/tables/:name`.
 * Call `uploadArrowTable(name, arrowBytes)` before issuing chart queries.
 *
 * ## Arrow IPC from Apache Arrow
 *
 * The response body for `type: 'arrow'` queries is a raw Arrow IPC stream
 * (`application/vnd.apache.arrow.stream`). Mosaic's wasmConnector returns a
 * flechette Table; this connector returns the same shape by parsing the
 * ArrayBuffer with `tableFromIPC` from apache-arrow.
 */
import { tableFromIPC } from "apache-arrow";

const ARROW_CONTENT_TYPE = "application/vnd.apache.arrow.stream";

export interface NativeConnectorOptions {
  /** Loopback server base URL (e.g. `http://127.0.0.1:54321`) */
  serverUrl: string;
  /** Per-launch bearer token for the loopback server */
  token: string;
}

export interface NativeMosaicConnector {
  query(query: { type?: "arrow"; sql: string }): Promise<unknown>;
  query(query: { type: "exec"; sql: string }): Promise<void>;
  query(query: {
    type: "json";
    sql: string;
  }): Promise<Record<string, unknown>[]>;
  /**
   * Upload an Arrow IPC buffer as a named table in the native engine.
   * Must be called before issuing chart queries that reference this table.
   */
  uploadArrowTable(name: string, arrowBytes: Uint8Array): Promise<void>;
}

/**
 * Create a Mosaic Connector wired to the native DuckDB engine's Arrow IPC
 * endpoint. The connector is a structural match for `@uwdata/mosaic-core`'s
 * `Connector` interface — Mosaic's Coordinator accepts it directly.
 */
export function createNativeConnector(
  options: NativeConnectorOptions,
): NativeMosaicConnector {
  const { serverUrl, token } = options;
  const arrowEndpoint = `${serverUrl}/data/arrow`;

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function query(q: { type?: string; sql: string }): Promise<unknown> {
    const type = q.type ?? "arrow";

    const res = await fetch(arrowEndpoint, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ type, sql: q.sql }),
    });

    if (!res.ok) {
      // Keep loopback errors out of the UI — surface as a human-readable throw.
      const text = await res.text().catch(() => String(res.status));
      throw new Error(`Native engine query failed (${res.status}): ${text}`);
    }

    if (type === "exec") {
      // exec: no result body, nothing to return.
      return undefined;
    }

    if (type === "json") {
      // json: server returns a JSON array of row objects.
      return (await res.json()) as Record<string, unknown>[];
    }

    // arrow (default): server returns raw Arrow IPC bytes. Decode into an
    // apache-arrow Table matching the shape mosaic-core / flechette expects.
    const buf = await res.arrayBuffer();
    return tableFromIPC(new Uint8Array(buf));
  }

  async function uploadArrowTable(
    name: string,
    arrowBytes: Uint8Array,
  ): Promise<void> {
    const tableEndpoint = `${serverUrl}/data/tables/${encodeURIComponent(name)}`;
    const res = await fetch(tableEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": ARROW_CONTENT_TYPE,
      },
      body: arrowBytes,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => String(res.status));
      throw new Error(
        `Failed to upload table "${name}" (${res.status}): ${text}`,
      );
    }
  }

  // Cast through unknown: TypeScript can't narrow the overloaded query
  // signatures to a single implementation, but the runtime dispatches
  // correctly based on q.type.
  return { query, uploadArrowTable } as unknown as NativeMosaicConnector;
}
