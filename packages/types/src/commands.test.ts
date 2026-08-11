import { describe, expect, it } from "vitest";

import {
  COMMAND_PATHS,
  buildInsightUpdateCommands,
  buildMetricDiffCommands,
  buildVisualizationUpdateCommands,
  cmd,
  resultValueByCommandPath,
} from "./commands";
import type { Insight } from "./insights";
import type { InsightMetric } from "./metric";
import type { UUID } from "./uuid";

const id = "11111111-1111-4111-8111-111111111111" as UUID;
const midA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as UUID;
const midB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as UUID;
const tableId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as UUID;

function metric(mid: UUID, name: string): InsightMetric {
  return {
    id: mid,
    name,
    sourceTable: tableId,
    aggregation: "sum",
    columnName: "amount",
  };
}

const baseInsight: Pick<Insight, "metrics"> = {
  metrics: [],
};

describe("cmd + COMMAND_PATHS", () => {
  it("builds a path-checked envelope", () => {
    expect(cmd("RenameNode", { id, name: "New" })).toEqual({
      path: "renameNode",
      args: { id, name: "New" },
    });
    expect(COMMAND_PATHS.CreateDataSource).toBe("createDataSource");
  });
});

describe("buildMetricDiffCommands", () => {
  it("emits AddMetric for a new metric", () => {
    const next = [metric(midA, "Sum")];
    expect(buildMetricDiffCommands(id, [], next)).toEqual([
      cmd("AddMetric", { nodeId: id, metric: next[0]! }),
    ]);
  });

  it("emits RemoveMetric for a dropped metric", () => {
    const prev = [metric(midA, "Sum")];
    expect(buildMetricDiffCommands(id, prev, [])).toEqual([
      cmd("RemoveMetric", { nodeId: id, metricId: midA }),
    ]);
  });

  it("emits UpdateMetric when a field changes value", () => {
    const prev = metric(midA, "Sum");
    const next = { ...prev, columnName: "revenue" };
    expect(buildMetricDiffCommands(id, [prev], [next])).toEqual([
      {
        path: "updateMetric",
        args: {
          nodeId: id,
          metricId: midA,
          updates: {
            name: "Sum",
            sourceTable: tableId,
            aggregation: "sum",
            columnName: "revenue",
          },
        },
      },
    ]);
  });

  it("rebuilds rather than merging when an edit clears a field", () => {
    // sum(amount) -> count(*): `columnName` is cleared. A merge cannot express
    // that (undefined does not survive JSON), so the metric is rebuilt.
    const prev = metric(midA, "Sum");
    const next: InsightMetric = {
      ...prev,
      name: "Row Count",
      aggregation: "count",
      columnName: undefined,
    };
    const commands = buildMetricDiffCommands(id, [prev], [next]);
    expect(commands).toEqual([
      cmd("RemoveMetric", { nodeId: id, metricId: midA }),
      cmd("AddMetric", { nodeId: id, metric: next }),
    ]);
  });

  it("rebuilds via remove+add when order changes", () => {
    const a = metric(midA, "A");
    const b = metric(midB, "B");
    const commands = buildMetricDiffCommands(id, [a, b], [b, a]);
    expect(commands.map((c) => c.path)).toEqual([
      "removeMetric",
      "removeMetric",
      "addMetric",
      "addMetric",
    ]);
  });
});

describe("buildInsightUpdateCommands", () => {
  it("decomposes multi-slice updates into one command list", () => {
    const commands = buildInsightUpdateCommands(id, baseInsight, {
      name: "Renamed",
      selectedFields: [midA],
      sorts: [{ field: "amount", direction: "desc" }],
      runtimeControls: { limit: { min: 1, max: 100 } },
      metrics: [metric(midA, "Sum")],
    });
    expect(commands.map((c) => c.path)).toEqual([
      "renameNode",
      "selectFields",
      "setInsightSort",
      "addMetric",
      "setInsightRuntimeControls",
    ]);
  });

  it("adds metrics before runtime controls validate their result aliases", () => {
    const addedMetric = metric(midA, "Sum");
    const commands = buildInsightUpdateCommands(id, baseInsight, {
      metrics: [addedMetric],
      runtimeControls: {
        sort: { allowedFieldIds: [addedMetric.id], maxKeys: 1 },
      },
    });

    expect(commands.map((command) => command.path)).toEqual([
      "addMetric",
      "setInsightRuntimeControls",
    ]);
  });

  it("returns empty when no known slices are present", () => {
    expect(buildInsightUpdateCommands(id, baseInsight, {})).toEqual([]);
  });

  it("throws rather than silently dropping filters or joins", () => {
    expect(() =>
      buildInsightUpdateCommands(id, baseInsight, {
        filters: [{ field: "region", operator: "eq", value: "EMEA" }],
      }),
    ).toThrow(/filters are not supported/);
    expect(() =>
      buildInsightUpdateCommands(id, baseInsight, {
        joins: [
          {
            type: "inner",
            rightTableId: tableId,
            leftKey: "id",
            rightKey: "id",
          },
        ],
      }),
    ).toThrow(/joins are not supported/);
  });
});

describe("buildVisualizationUpdateCommands", () => {
  it("emits RenameNode + SetChartType + SetChartEncoding together", () => {
    const commands = buildVisualizationUpdateCommands(id, {
      name: "Chart",
      visualizationType: "barY",
      encoding: {
        x: `field:${id}`,
        y: `metric:${midA}`,
      },
    });
    expect(commands.map((c) => c.path)).toEqual([
      "renameNode",
      "setChartType",
      "setChartEncoding",
    ]);
  });
});

describe("resultValueByCommandPath", () => {
  it("path-matches the CreateDataSource result (not index 0 blindly)", () => {
    const create = cmd("CreateDataSource", {
      id,
      type: "notion",
      name: "N",
    });
    const config = cmd("SetDataSourceConfig", {
      id,
      extra: { defaultSchema: "public" },
    });
    const batch = {
      commands: [create, config],
      results: [{ value: { id } }, { value: { ok: true } }],
    };
    expect(
      resultValueByCommandPath(batch, COMMAND_PATHS.CreateDataSource),
    ).toEqual({ id });
    expect(
      resultValueByCommandPath(batch, COMMAND_PATHS.SetDataSourceConfig),
    ).toEqual({ ok: true });
  });

  it("throws when the path is missing", () => {
    expect(() =>
      resultValueByCommandPath(
        { commands: [], results: [] },
        COMMAND_PATHS.CreateDataSource,
      ),
    ).toThrow(/no command with path/);
  });
});
