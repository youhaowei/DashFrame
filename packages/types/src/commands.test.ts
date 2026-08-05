import { describe, expect, it } from "vitest";

import {
  COMMAND_PATHS,
  buildInsightUpdateCommands,
  buildJoinDiffCommands,
  buildMetricDiffCommands,
  buildVisualizationUpdateCommands,
  cmd,
  resultValueByCommandPath,
  toDomainFilters,
  toTypedFilters,
  unwrapFilterOperand,
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

const baseInsight: Pick<
  Insight,
  "metrics" | "joins" | "selectedFields" | "filters" | "sorts" | "name"
> = {
  name: "I",
  selectedFields: [],
  metrics: [],
  filters: undefined,
  sorts: undefined,
  joins: undefined,
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

describe("filter operand wrap/unwrap", () => {
  it("wraps domain filters as tagged value operands", () => {
    expect(
      toTypedFilters([{ field: "region", operator: "eq", value: "EMEA" }]),
    ).toEqual([
      {
        field: "region",
        operator: "eq",
        value: { kind: "value", v: "EMEA" },
      },
    ]);
  });

  it("unwraps tagged values and leaves plain values alone", () => {
    expect(unwrapFilterOperand({ kind: "value", v: "EMEA" })).toBe("EMEA");
    expect(unwrapFilterOperand("plain")).toBe("plain");
    expect(
      toDomainFilters([
        {
          field: "region",
          operator: "eq",
          value: { kind: "value", v: "EMEA" },
        },
      ]),
    ).toEqual([{ field: "region", operator: "eq", value: "EMEA" }]);
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

describe("buildJoinDiffCommands", () => {
  const joinA = {
    type: "inner" as const,
    rightTableId: tableId,
    leftKey: "id",
    rightKey: "id",
  };

  it("emits AddJoin when appending", () => {
    expect(buildJoinDiffCommands(id, [], [joinA])).toEqual([
      cmd("AddJoin", { id, join: joinA }),
    ]);
  });

  it("emits RemoveJoin for a single removal", () => {
    expect(buildJoinDiffCommands(id, [joinA], [])).toEqual([
      cmd("RemoveJoin", { id, joinIndex: 0 }),
    ]);
  });
});

describe("buildInsightUpdateCommands", () => {
  it("decomposes multi-slice updates into one command list", () => {
    const commands = buildInsightUpdateCommands(id, baseInsight, {
      name: "Renamed",
      selectedFields: [midA],
      sorts: [{ field: "amount", direction: "desc" }],
      filters: [{ field: "region", operator: "eq", value: "EMEA" }],
      metrics: [metric(midA, "Sum")],
    });
    expect(commands.map((c) => c.path)).toEqual([
      "renameNode",
      "selectFields",
      "setInsightFilter",
      "setInsightSort",
      "addMetric",
    ]);
  });

  it("returns empty when no known slices are present", () => {
    expect(buildInsightUpdateCommands(id, baseInsight, {})).toEqual([]);
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
