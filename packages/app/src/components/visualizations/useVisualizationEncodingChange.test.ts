import type {
  ColumnAnalysis,
  CompiledInsight,
  DataTable,
  UUID,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { fieldEncoding, metricEncoding } from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useVisualizationEncodingChange } from "./useVisualizationEncodingChange";

const visualizationId = "viz-1" as UUID;
const dimensionId = "22222222-2222-4222-8222-222222222222" as UUID;
const metricId = "33333333-3333-4333-8333-333333333333" as UUID;
const tableId = "44444444-4444-4444-8444-444444444444" as UUID;
const dimensionAlias = "field_22222222_2222_4222_8222_222222222222";
const validationTable = {
  fields: [
    {
      id: dimensionId,
      tableId,
      name: "Region",
      columnName: "region",
      type: "string",
    },
  ],
} as Pick<DataTable, "fields">;
const validationInsight = {
  id: "55555555-5555-4555-8555-555555555555" as UUID,
  name: "Orders by region",
  dimensions: validationTable.fields,
  metrics: [
    {
      id: metricId,
      name: "Total orders",
      sourceTable: tableId,
      columnName: "orders",
      aggregation: "sum",
    },
  ],
  filters: [],
  sorts: [],
} as CompiledInsight;
const validationAnalysis: ColumnAnalysis[] = [
  {
    columnName: dimensionAlias,
    fieldId: dimensionId,
    dataType: "string",
    semantic: "categorical",
    cardinality: 5,
    uniqueness: 0.25,
    nullCount: 0,
    sampleValues: ["APAC", "EMEA"],
  },
];

function renderEncodingHook(
  encoding: VisualizationEncoding,
  updateVisualization: (args: {
    id: UUID;
    updates: {
      encoding?: VisualizationEncoding;
      visualizationType?: VisualizationType;
    };
  }) => Promise<unknown>,
) {
  return renderHook(
    ({ current }: { current: VisualizationEncoding }) =>
      useVisualizationEncodingChange({
        visualization: {
          id: visualizationId,
          visualizationType: "barY",
          encoding: current,
        },
        dataTable: { fields: [] },
        columnAnalysis: [],
        updateVisualization,
      }),
    { initialProps: { current: encoding } },
  );
}

describe("useVisualizationEncodingChange", () => {
  it.each([
    {
      initialType: "barY" as const,
      nextType: "barX" as const,
      initialEncoding: {
        x: fieldEncoding(dimensionId),
        y: metricEncoding(metricId),
      },
      channel: "x" as const,
      invalidValue: fieldEncoding(dimensionId),
      validValue: metricEncoding(metricId),
      repairChannel: "y" as const,
      repairValue: fieldEncoding(dimensionId),
    },
    {
      initialType: "barX" as const,
      nextType: "barY" as const,
      initialEncoding: {
        x: metricEncoding(metricId),
        y: fieldEncoding(dimensionId),
      },
      channel: "y" as const,
      invalidValue: fieldEncoding(dimensionId),
      validValue: metricEncoding(metricId),
      repairChannel: "x" as const,
      repairValue: fieldEncoding(dimensionId),
    },
  ])(
    "validates $channel edits against a pending $nextType orientation without blocking repairs",
    async ({
      initialType,
      nextType,
      initialEncoding,
      channel,
      invalidValue,
      validValue,
      repairChannel,
      repairValue,
    }) => {
      let resolveTypeChange: (() => void) | undefined;
      const updateVisualization = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveTypeChange = resolve;
            }),
        )
        .mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useVisualizationEncodingChange({
          visualization: {
            id: visualizationId,
            visualizationType: initialType,
            encoding: initialEncoding,
          },
          dataTable: validationTable,
          columnAnalysis: validationAnalysis,
          compiledInsight: validationInsight,
          updateVisualization,
        }),
      );

      let typeWrite: Promise<void> | undefined;
      await act(async () => {
        typeWrite = result.current.changeType(nextType);
      });
      await act(async () => {
        await result.current.changeEncoding(channel, invalidValue);
      });
      expect(updateVisualization).toHaveBeenCalledOnce();

      await act(async () => {
        await result.current.changeEncoding(channel, validValue);
        await result.current.changeEncoding(channel, "");
        await result.current.changeEncoding(repairChannel, repairValue);
      });
      expect(updateVisualization).toHaveBeenCalledTimes(4);
      expect(updateVisualization).toHaveBeenLastCalledWith({
        id: visualizationId,
        updates: expect.objectContaining({ visualizationType: nextType }),
      });

      await act(async () => {
        resolveTypeChange?.();
        await typeWrite;
      });
    },
  );

  it("keeps each visualization's pending encoding across an A-B-A switch", async () => {
    const visualizationA = "viz-a" as UUID;
    const visualizationB = "viz-b" as UUID;
    const updateVisualization = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ id, encoding }: { id: UUID; encoding: VisualizationEncoding }) =>
        useVisualizationEncodingChange({
          visualization: { id, visualizationType: "dot", encoding },
          dataTable: { fields: [] },
          columnAnalysis: [],
          updateVisualization,
        }),
      {
        initialProps: {
          id: visualizationA,
          encoding: { y: "revenue" },
        },
      },
    );

    act(() => {
      result.current.changeEncoding("color", "region").catch(() => {});
    });
    rerender({ id: visualizationB, encoding: { y: "profit" } });
    act(() => {
      result.current.changeEncoding("color", "channel").catch(() => {});
    });
    rerender({ id: visualizationA, encoding: { y: "revenue" } });
    await act(async () => {
      await result.current.changeEncoding("size", "orders");
    });

    expect(updateVisualization).toHaveBeenLastCalledWith({
      id: visualizationA,
      updates: {
        encoding: { y: "revenue", color: "region", size: "orders" },
      },
    });
  });

  it("keeps a bar orientation swap when an encoding edit lands before its echo", async () => {
    let resolveTypeChange: (() => void) | undefined;
    const updateVisualization = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveTypeChange = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { result } = renderEncodingHook(
      {
        x: "month",
        y: "revenue",
        xTransform: {
          type: "date",
          transform: { kind: "temporal", aggregation: "month" },
        },
      },
      updateVisualization,
    );

    let typeWrite: Promise<void> | undefined;
    await act(async () => {
      typeWrite = result.current.changeType("barX");
      await result.current.changeEncoding("color", "region");
    });

    expect(updateVisualization).toHaveBeenNthCalledWith(2, {
      id: visualizationId,
      updates: {
        visualizationType: "barX",
        encoding: {
          x: "revenue",
          y: "month",
          yTransform: {
            type: "date",
            transform: { kind: "temporal", aggregation: "month" },
          },
          color: "region",
        },
      },
    });
    await act(async () => {
      resolveTypeChange?.();
      await typeWrite;
    });
  });

  it("keeps an earlier channel when a second edit lands before the first write echoes", async () => {
    let resolveFirst: (() => void) | undefined;
    const updateVisualization = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { result } = renderEncodingHook(
      { y: "revenue" },
      updateVisualization,
    );

    let firstWrite: Promise<void> | undefined;
    await act(async () => {
      firstWrite = result.current.changeEncoding("color", "channel");
      await result.current.changeEncoding("size", "orders");
    });

    expect(updateVisualization).toHaveBeenNthCalledWith(2, {
      id: visualizationId,
      updates: {
        encoding: { y: "revenue", color: "channel", size: "orders" },
      },
    });

    await act(async () => {
      resolveFirst?.();
      await firstWrite;
    });
  });

  it("keeps a later edit's channel when an earlier write fails", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    const updateVisualization = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockResolvedValue(undefined);
    const { result } = renderEncodingHook(
      { y: "revenue" },
      updateVisualization,
    );

    let firstWrite: Promise<void> | undefined;
    await act(async () => {
      firstWrite = result.current.changeEncoding("x", "month");
      // Never settles: this write stays in flight for the rest of the test.
      result.current.changeEncoding("color", "channel").catch(() => {});
      rejectFirst?.(new Error("write failed"));
      await expect(firstWrite).rejects.toThrow("write failed");
    });
    await act(async () => {
      await result.current.changeEncoding("size", "orders");
    });

    expect(updateVisualization).toHaveBeenLastCalledWith({
      id: visualizationId,
      updates: {
        encoding: {
          y: "revenue",
          x: "month",
          color: "channel",
          size: "orders",
        },
      },
    });
  });

  it("keeps a successful edit awaiting its echo when a newer write fails", async () => {
    const updateVisualization = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValue(undefined);
    const { result } = renderEncodingHook(
      { y: "revenue" },
      updateVisualization,
    );

    await act(async () => {
      await result.current.changeEncoding("color", "channel");
      await expect(
        result.current.changeEncoding("size", "orders"),
      ).rejects.toThrow("write failed");
      await result.current.changeEncoding("x", "month");
    });

    expect(updateVisualization).toHaveBeenLastCalledWith({
      id: visualizationId,
      updates: {
        encoding: { y: "revenue", color: "channel", x: "month" },
      },
    });
  });

  it("builds on a newer render, not the saved snapshot, when a later write fails", async () => {
    let rejectSecond: ((error: Error) => void) | undefined;
    const updateVisualization = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSecond = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const { result, rerender } = renderEncodingHook(
      { y: "revenue" },
      updateVisualization,
    );

    let secondWrite: Promise<void> | undefined;
    await act(async () => {
      await result.current.changeEncoding("color", "channel");
      secondWrite = result.current.changeEncoding("size", "orders");
    });
    rerender({ current: { y: "profit", color: "channel" } });
    await act(async () => {
      rejectSecond?.(new Error("write failed"));
      await expect(secondWrite).rejects.toThrow("write failed");
      await result.current.changeEncoding("x", "month");
    });

    expect(updateVisualization).toHaveBeenLastCalledWith({
      id: visualizationId,
      updates: {
        encoding: { y: "profit", color: "channel", x: "month" },
      },
    });
  });

  it("validates a type change against the pending encoding", async () => {
    const updateVisualization = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockResolvedValue(undefined);
    const canChangeType = vi.fn().mockReturnValue(false);
    const { result } = renderHook(() =>
      useVisualizationEncodingChange({
        visualization: {
          id: visualizationId,
          visualizationType: "barY",
          encoding: { x: "month", y: "revenue" },
        },
        dataTable: { fields: [] },
        columnAnalysis: [],
        updateVisualization,
        canChangeType: (visualization, nextType) =>
          nextType === "barX" || canChangeType(visualization, nextType),
      }),
    );

    let barWrite: Promise<void> | undefined;
    await act(async () => {
      barWrite = result.current.changeType("barX");
      await result.current.changeType("line");
    });
    expect(barWrite).toBeInstanceOf(Promise);

    expect(canChangeType).toHaveBeenCalledWith(
      {
        id: visualizationId,
        visualizationType: "barX",
        encoding: expect.objectContaining({ x: "revenue", y: "month" }),
      },
      "line",
    );
    expect(updateVisualization).toHaveBeenCalledOnce();
  });

  it("builds on the refreshed encoding once writes have settled", async () => {
    const updateVisualization = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderEncodingHook(
      { y: "revenue" },
      updateVisualization,
    );

    await act(async () => {
      await result.current.changeEncoding("color", "channel");
    });
    rerender({ current: { y: "orders", color: "region" } });
    await act(async () => {
      await result.current.changeEncoding("size", "count");
    });

    expect(updateVisualization).toHaveBeenLastCalledWith({
      id: visualizationId,
      updates: {
        encoding: { y: "orders", color: "region", size: "count" },
      },
    });
  });
});
