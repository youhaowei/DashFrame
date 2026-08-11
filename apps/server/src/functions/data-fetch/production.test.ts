import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import {
  FileDataFrameStorage,
  NativeDuckDBEngine,
} from "@dashframe/engine-server";
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { DataTable, InsightFetchDefinition, UUID } from "@dashframe/types";
import { Table, tableToIPC, vectorFromArray } from "apache-arrow";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LOCAL_USER_ID } from "../../permissions";
import { wy } from "../../wystack";
import { createDataFetchFunctions } from "../data-fetch";
import {
  createProductionFetchExecutor,
  productionMaterializerDependencies,
} from "./production";

const tableId = "10000000-0000-4000-8000-000000000001" as UUID;
const fieldId = "10000000-0000-4000-8000-000000000002" as UUID;
const fieldAlias = fieldIdToColumnAlias(fieldId);
const table = {
  id: tableId,
  dataSourceId: "10000000-0000-4000-8000-000000000003",
  name: "Orders",
  table: "orders.csv",
  fields: [
    {
      id: fieldId,
      tableId,
      name: "Revenue",
      columnName: "amount",
      type: "number",
    },
  ],
  metrics: [],
  dataFrameId: "10000000-0000-4000-8000-000000000004",
  createdAt: 0,
} as DataTable;
const insight: InsightFetchDefinition = {
  baseTableId: tableId,
  selectedFields: [],
  metrics: [],
};

function resultArrow(name: string) {
  return tableToIPC(new Table({ [name]: vectorFromArray([10, 20]) }));
}

describe("production result schema", () => {
  it("keeps SQL aliases structural while publishing human display metadata", () => {
    const inspect = productionMaterializerDependencies().inspect;
    expect(
      inspect(resultArrow(fieldAlias), {
        insight,
        tables: new Map([[tableId, table]]),
      }),
    ).toEqual({
      rowCount: 2,
      schema: [{ id: fieldAlias, name: "Revenue", type: "number" }],
    });
  });

  it("derives min and max result types from the resolved source field", () => {
    const inspect = productionMaterializerDependencies().inspect;
    const metricInsight: InsightFetchDefinition = {
      baseTableId: tableId,
      selectedFields: [],
      metrics: [
        {
          id: "10000000-0000-4000-8000-000000000099",
          name: "Earliest",
          sourceTable: tableId,
          columnName: "amount",
          aggregation: "min",
        },
      ],
    };
    const alias = metricIdToColumnAlias("10000000-0000-4000-8000-000000000099");
    expect(
      inspect(resultArrow(alias), {
        insight: metricInsight,
        tables: new Map([
          [
            tableId,
            {
              ...table,
              fields: [{ ...table.fields[0]!, type: "date" as const }],
            },
          ],
        ]),
      }).schema,
    ).toEqual([{ id: alias, name: "Earliest", type: "date" }]);
  });

  it("fails closed when native execution returns an undeclared result column", () => {
    const inspect = productionMaterializerDependencies().inspect;
    expect(() =>
      inspect(resultArrow("unexpected"), {
        insight,
        tables: new Map([[tableId, table]]),
      }),
    ).toThrow("SOURCE_SCHEMA_CHANGED");
  });
});

describe("registered production Insight composition", () => {
  it("runs DataTable Insight A through saved Insight B without resolving B as a table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-composed-fetch-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const storage = new FileDataFrameStorage(join(dir, "frames"));
    const engine = new NativeDuckDBEngine();
    try {
      const sourceId = crypto.randomUUID();
      const localTableId = crypto.randomUUID();
      const sourceFrameId = crypto.randomUUID();
      const sourceFieldId = crypto.randomUUID();
      const upstreamInsightId = crypto.randomUUID();
      const derivedInsightId = crypto.randomUUID();
      const sourceArrow = tableToIPC(
        new Table({ country: vectorFromArray(["US", "CA"]) }),
      );
      await storage.save(sourceFrameId, sourceArrow);
      await db.insert(schema.dataSources).values({
        id: sourceId,
        name: "Local",
        kind: "local",
        storage: "live",
        config: { sourceBindingVersion: "v1" },
        createdBy: { kind: "user" },
      });
      await db.insert(schema.dataFrames).values({
        id: sourceFrameId,
        storage: { type: "file", key: sourceFrameId },
        fieldIds: [sourceFieldId],
        name: "Local frame",
        sourceId,
        definitionId: localTableId,
        rowCount: 2,
        columnCount: 1,
      });
      await db.insert(schema.dataTables).values({
        id: localTableId,
        dataSourceId: sourceId,
        name: "Countries",
        table: "countries",
        fields: [
          {
            id: sourceFieldId,
            tableId: localTableId,
            name: "Country",
            columnName: "country",
            type: "string",
          },
        ],
        metrics: [],
        dataFrameId: sourceFrameId,
      });
      await db.insert(schema.insights).values([
        {
          id: upstreamInsightId,
          name: "A",
          definition: {
            baseTableId: localTableId,
            source: { sourceType: "dataTable", sourceId: localTableId },
            selectedFields: [sourceFieldId],
            metrics: [],
          },
          createdBy: { kind: "user" },
        },
        {
          id: derivedInsightId,
          name: "B",
          definition: {
            baseTableId: upstreamInsightId,
            source: { sourceType: "insight", sourceId: upstreamInsightId },
            selectedFields: [sourceFieldId],
            metrics: [],
          },
          createdBy: { kind: "user" },
        },
      ]);
      const app = await wy.build({
        db,
        functions: createDataFetchFunctions(createProductionFetchExecutor()),
      });

      const ephemeral = await app.call(
        "fetchData",
        {
          insight: {
            baseTableId: upstreamInsightId,
            selectedFields: [sourceFieldId],
            metrics: [],
          },
        },
        {
          principal: { kind: "user", userId: LOCAL_USER_ID },
          dataFrameStorage: storage,
          dataPlaneRuntime: engine,
        },
      );
      expect(ephemeral.result).toMatchObject({ status: "ready", rowCount: 2 });

      const { result } = await app.call(
        "runInsight",
        { insightId: derivedInsightId },
        {
          principal: { kind: "user", userId: LOCAL_USER_ID },
          dataFrameStorage: storage,
          dataPlaneRuntime: engine,
        },
      );

      expect(result).toMatchObject({ status: "ready", rowCount: 2 });
      expect((result as { dataFrameId: string }).dataFrameId).not.toBe(
        sourceFrameId,
      );
      expect(
        (await db.select().from(schema.dataFrames)).some(
          (frame) => frame.insightId === derivedInsightId,
        ),
      ).toBe(true);
      expect(await db.select().from(schema.dataFrames)).toHaveLength(3);
    } finally {
      await engine.dispose();
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
