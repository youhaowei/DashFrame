import {
  NativeDuckDBEngine,
  arrowIpcToJsonRows,
} from "@dashframe/engine-server";
import type { ApplicationOperations } from "./host/application";

interface StoredSource {
  id: string;
  type: string;
  name: string;
}

interface StoredTable {
  id: string;
  dataSourceId: string;
  name: string;
  fields: Array<{ columnName?: string; name: string; type: string }>;
}

interface StoredFrame {
  dataFrameId: string;
  rowCount: number;
  columnCount: number;
}

/** Project-shaped fixture: command writes are idempotent and frames use real DuckDB. */
export class SampleSeedProjectFixture {
  readonly sources = new Map<string, StoredSource>();
  readonly tables = new Map<string, StoredTable>();
  readonly frames = new Map<string, StoredFrame>();
  readonly application: Pick<ApplicationOperations, "execute">;
  private readonly completed = new Map<string, unknown>();
  private readonly engine = new NativeDuckDBEngine();

  constructor() {
    this.application = { execute: this.execute.bind(this) };
  }

  async initialize(): Promise<void> {
    await this.engine.initialize();
  }

  async dispose(): Promise<void> {
    await this.engine.dispose();
  }

  async queryFrame(dataFrameId: string, sql: string) {
    const tableName = `df_${dataFrameId.replaceAll("-", "_")}`;
    const arrow = await this.engine.queryArrow(
      sql.replaceAll("$TABLE", `\"${tableName}\"`),
    );
    return arrowIpcToJsonRows(arrow);
  }

  private async execute(
    operation: string,
    input: unknown,
    context?: Parameters<ApplicationOperations["execute"]>[2],
  ): Promise<unknown> {
    const args = input as Record<string, unknown>;
    const operationId = context?.operationId ?? String(args.operationId ?? "");
    if (operationId && this.completed.has(operationId)) {
      return this.completed.get(operationId);
    }

    let result: unknown;
    if (operation === "createDataSource") {
      const source = args as unknown as StoredSource;
      this.sources.set(source.id, source);
      result = { id: source.id };
    } else if (operation === "createDataTable") {
      const table = args as unknown as StoredTable;
      if (!this.sources.has(table.dataSourceId))
        throw new Error("Missing source");
      this.tables.set(table.id, table);
      result = { id: table.id };
    } else if (operation === "ingestLocalDataFrame") {
      const dataTableId = String(args.dataTableId);
      if (!this.tables.has(dataTableId)) throw new Error("Missing table");
      const dataFrameId = operationId;
      const arrow = new Uint8Array(
        Buffer.from(String(args.arrowBase64), "base64"),
      );
      const tableName = `df_${dataFrameId.replaceAll("-", "_")}`;
      await this.engine.registerArrowTable(tableName, arrow);
      const [count] = await this.queryFrame(
        dataFrameId,
        "SELECT COUNT(*) AS count FROM $TABLE",
      );
      const table = this.tables.get(dataTableId)!;
      result = {
        dataFrameId,
        rowCount: Number(count?.count),
        columnCount: table.fields.length,
      } satisfies StoredFrame;
      this.frames.set(dataTableId, result as StoredFrame);
    } else {
      throw new Error(`Unsupported fixture operation: ${operation}`);
    }

    if (operationId) this.completed.set(operationId, result);
    return result;
  }
}
