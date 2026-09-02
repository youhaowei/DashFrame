import {
  NativeDuckDBEngine,
  arrowIpcToJsonRows,
} from "@dashframe/engine-server";
import type { Field, InsightMetric, Metric } from "@dashframe/types";
import type { ApplicationOperations } from "./host/application";

const UNHANDLED = Symbol("unhandled");

interface StoredSource {
  id: string;
  type: string;
  name: string;
}

interface StoredTable {
  id: string;
  dataSourceId: string;
  name: string;
  table: string;
  fields: Field[];
  metrics: Metric[];
  dataFrameId?: string;
}

interface StoredInsight {
  id: string;
  name: string;
  source: { sourceType: "dataTable"; sourceId: string };
  selectedFields: string[];
  metrics: InsightMetric[];
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
  readonly insights = new Map<string, StoredInsight>();
  readonly application: Pick<ApplicationOperations, "execute">;
  private readonly completed = new Map<string, unknown>();
  private readonly importRequests = new Map<
    string,
    { arrowBase64: string; result: StoredFrame }
  >();
  private readonly invalidatedImports = new Set<string>();
  private sourceReadBarrier?: {
    remaining: number;
    promise: Promise<void>;
    release: () => void;
  };
  private readonly engine = new NativeDuckDBEngine();

  constructor() {
    this.application = { execute: this.execute.bind(this) };
  }

  forPrincipalApplication(): Pick<ApplicationOperations, "execute"> {
    return { execute: this.execute.bind(this) };
  }

  synchronizeNextSourceReads(callers: number): void {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sourceReadBarrier = { remaining: callers, promise, release };
  }

  async initialize(): Promise<void> {
    await this.engine.initialize();
  }

  async dispose(): Promise<void> {
    await this.engine.dispose();
  }

  clearWorkspace(): void {
    this.sources.clear();
    this.tables.clear();
    this.frames.clear();
    for (const operationId of this.importRequests.keys()) {
      this.invalidatedImports.add(operationId);
    }
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
    const read = await this.readOperation(operation, args);
    if (read !== UNHANDLED) return read;
    if (this.isCompletedCommand(operation, operationId)) {
      return this.completed.get(operationId);
    }

    const result = await this.writeOperation(operation, args, operationId);
    if (operationId) this.completed.set(operationId, result);
    return result;
  }

  private async readOperation(
    operation: string,
    args: Record<string, unknown>,
  ): Promise<unknown | typeof UNHANDLED> {
    if (operation === "getDataSource") {
      const source = this.sources.get(String(args.id)) ?? null;
      await this.waitForSourceReadBarrier();
      return source;
    }
    if (operation === "getDataTable") {
      return this.tables.get(String(args.id)) ?? null;
    }
    if (operation === "getDataFrameEntry") {
      const frame = [...this.frames.values()].find(
        (candidate) => candidate.dataFrameId === args.id,
      );
      return frame ? { ...frame, id: frame.dataFrameId } : null;
    }
    if (operation === "getInsight") {
      return this.insights.get(String(args.id)) ?? null;
    }
    return UNHANDLED;
  }

  private async waitForSourceReadBarrier(): Promise<void> {
    const barrier = this.sourceReadBarrier;
    if (!barrier) return;
    barrier.remaining -= 1;
    if (barrier.remaining === 0) {
      this.sourceReadBarrier = undefined;
      barrier.release();
    }
    await barrier.promise;
  }

  private isCompletedCommand(operation: string, operationId: string): boolean {
    return (
      operation !== "ingestLocalDataFrame" &&
      Boolean(operationId) &&
      this.completed.has(operationId)
    );
  }

  private async writeOperation(
    operation: string,
    args: Record<string, unknown>,
    operationId: string,
  ): Promise<unknown> {
    if (operation === "createDataSource") {
      const source = args as unknown as StoredSource;
      if (this.sources.has(source.id)) {
        throw new Error(`dataSource ${source.id} already exists`);
      }
      this.sources.set(source.id, source);
      return { id: source.id };
    }
    if (operation === "createDataTable") {
      const table = args as unknown as StoredTable;
      if (!this.sources.has(table.dataSourceId))
        throw new Error("Missing source");
      if (this.tables.has(table.id)) {
        throw new Error(`dataTable ${table.id} already exists`);
      }
      this.tables.set(table.id, table);
      return { id: table.id };
    }
    if (operation === "ingestLocalDataFrame") {
      return this.ingest(args, operationId);
    }
    if (operation === "addMetric") {
      const table = this.tables.get(String(args.nodeId));
      if (!table) throw new Error("Missing table");
      table.metrics.push(args.metric as Metric);
      return { ok: true };
    }
    if (operation === "createInsightCmd") {
      const insight = args as unknown as StoredInsight;
      this.insights.set(insight.id, insight);
      return { id: insight.id };
    }
    throw new Error(`Unsupported fixture operation: ${operation}`);
  }

  private async ingest(
    args: Record<string, unknown>,
    operationId: string,
  ): Promise<StoredFrame> {
    if (this.invalidatedImports.has(operationId)) {
      throw new Error("Local import invalidated by workspace clear");
    }
    const arrowBase64 = String(args.arrowBase64);
    const priorImport = this.importRequests.get(operationId);
    if (priorImport && priorImport.arrowBase64 !== arrowBase64) {
      throw new Error("Local import operationId reused with different request");
    }
    if (priorImport) return priorImport.result;
    const dataTableId = String(args.dataTableId);
    if (!this.tables.has(dataTableId)) throw new Error("Missing table");
    const table = this.tables.get(dataTableId)!;
    const replacement = args.replacement as
      | (StoredTable & { expectedDataFrameId: string | null })
      | undefined;
    const expectedDataFrameId = replacement
      ? replacement.expectedDataFrameId
      : (table.dataFrameId ?? null);
    const dataFrameId = crypto.randomUUID();
    const arrow = new Uint8Array(Buffer.from(arrowBase64, "base64"));
    const tableName = `df_${dataFrameId.replaceAll("-", "_")}`;
    await this.engine.registerArrowTable(tableName, arrow);
    const [count] = await this.queryFrame(
      dataFrameId,
      "SELECT COUNT(*) AS count FROM $TABLE",
    );
    if ((table.dataFrameId ?? null) !== expectedDataFrameId) {
      throw new Error("SOURCE_BINDING_CHANGED");
    }
    if (replacement) Object.assign(table, replacement);
    table.dataFrameId = dataFrameId;
    const result = {
      dataFrameId,
      rowCount: Number(count?.count),
      columnCount: table.fields.length,
    } satisfies StoredFrame;
    this.frames.set(dataTableId, result);
    this.importRequests.set(operationId, { arrowBase64, result });
    return result;
  }
}
