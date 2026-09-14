import type {
  UUID,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useVisualizationEncodingChange } from "./useVisualizationEncodingChange";

const visualizationId = "viz-1" as UUID;

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
