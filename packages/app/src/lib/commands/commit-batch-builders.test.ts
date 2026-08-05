/**
 * Unit tests for the migrated UI write path: coarse domain patches decompose
 * into typed `cmd()` batches, and a commitBatch failure is not swallowed.
 *
 * The builders themselves live in `@dashframe/types` (client-safe); this file
 * covers the call-site contract packages/app relies on — right commands for a
 * given edit, and error propagation when the mutation rejects.
 */
import {
  COMMAND_PATHS,
  buildInsightUpdateCommands,
  buildVisualizationUpdateCommands,
  cmd,
  resultValueByCommandPath,
  type Insight,
  type InsightMetric,
  type UUID,
} from "@dashframe/types";
import { describe, expect, it, vi } from "vitest";

const insightId = "11111111-1111-4111-8111-111111111111" as UUID;
const vizId = "22222222-2222-4222-8222-222222222222" as UUID;
const fieldId = "33333333-3333-4333-8333-333333333333" as UUID;
const metricId = "44444444-4444-4444-8444-444444444444" as UUID;
const tableId = "55555555-5555-4555-8555-555555555555" as UUID;

const current: Pick<Insight, "metrics"> = {
  metrics: [],
};

/**
 * Stand-in for a migrated call site: build commands, dispatch commitBatch,
 * rethrow on failure (no legacy fallback).
 */
async function commitInsightUpdate(
  commitBatch: (args: { commands: unknown[] }) => Promise<unknown>,
  id: UUID,
  baseline: typeof current,
  updates: Partial<Omit<Insight, "id" | "createdAt">>,
): Promise<void> {
  const commands = buildInsightUpdateCommands(id, baseline, updates);
  if (commands.length === 0) return;
  await commitBatch({ commands });
}

describe("migrated insight write path", () => {
  it("builds SelectFields + SetInsightSort for field reorder + sort edit", async () => {
    const commitBatch = vi.fn().mockResolvedValue({ ok: true });
    await commitInsightUpdate(commitBatch, insightId, current, {
      selectedFields: [fieldId],
      sorts: [{ field: "amount", direction: "asc" }],
    });
    expect(commitBatch).toHaveBeenCalledTimes(1);
    const { commands } = commitBatch.mock.calls[0]![0] as {
      commands: { path: string }[];
    };
    expect(commands.map((c) => c.path)).toEqual([
      "selectFields",
      "setInsightSort",
    ]);
  });

  it("removes a join through an explicit RemoveJoin command", async () => {
    // Joins are never inferred from an array diff — the call site knows which
    // index the user removed and says so directly.
    const commitBatch = vi.fn().mockResolvedValue({ ok: true });
    await commitBatch({
      commands: [cmd("RemoveJoin", { id: insightId, joinIndex: 0 })],
    });
    expect(commitBatch).toHaveBeenCalledWith({
      commands: [{ path: "removeJoin", args: { id: insightId, joinIndex: 0 } }],
    });
  });

  it("surfaces commitBatch failure rather than succeeding silently", async () => {
    const commitBatch = vi
      .fn()
      .mockRejectedValue(new Error("commands.commit denied"));
    await expect(
      commitInsightUpdate(commitBatch, insightId, current, {
        name: "Nope",
      }),
    ).rejects.toThrow("commands.commit denied");
  });
});

describe("migrated visualization write path", () => {
  it("packs type + encoding into one batch", () => {
    const commands = buildVisualizationUpdateCommands(vizId, {
      visualizationType: "line",
      encoding: {
        x: `field:${fieldId}`,
        y: `metric:${metricId}`,
      },
    });
    expect(commands).toEqual([
      cmd("SetChartType", { id: vizId, visualizationType: "line" }),
      cmd("SetChartEncoding", {
        id: vizId,
        encoding: {
          x: `field:${fieldId}`,
          y: `metric:${metricId}`,
        },
      }),
    ]);
  });
});

describe("migrated CreateDataSource id extraction", () => {
  it("path-matches CreateDataSource even when not results[0]", () => {
    const create = cmd("CreateDataSource", {
      id: insightId,
      type: "postgres",
      name: "PG",
    });
    const config = cmd("SetDataSourceConfig", {
      id: insightId,
      extra: { defaultSchema: "public" },
    });
    // Put a leading no-op result shape first to prove we do not use index 0.
    const batch = {
      commands: [config, create],
      results: [{ value: { ok: true } }, { value: { id: insightId } }],
    };
    const created = resultValueByCommandPath(
      batch,
      COMMAND_PATHS.CreateDataSource,
    ) as { id: string };
    expect(created.id).toBe(insightId);
  });
});

describe("metric merge from chart suggestion path", () => {
  it("emits SelectFields + AddMetric in one batch", () => {
    const metrics: InsightMetric[] = [
      {
        id: metricId,
        name: "sum(amount)",
        sourceTable: tableId,
        aggregation: "sum",
        columnName: "amount",
      },
    ];
    const commands = buildInsightUpdateCommands(insightId, current, {
      selectedFields: [fieldId],
      metrics,
    });
    expect(commands.map((c) => c.path)).toEqual(["selectFields", "addMetric"]);
  });
});
