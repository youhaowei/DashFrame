import type { UUID, VisualizationEncoding } from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useVisualizationEncodingChange } from "./useVisualizationEncodingChange";

const visualizationId = "viz-1" as UUID;

function renderEncodingHook(
  encoding: VisualizationEncoding,
  updateVisualization: (args: {
    id: UUID;
    updates: { encoding: VisualizationEncoding };
  }) => Promise<unknown>,
) {
  return renderHook(
    ({ current }: { current: VisualizationEncoding }) =>
      useVisualizationEncodingChange({
        visualization: { id: visualizationId, encoding: current },
        dataTable: { fields: [] },
        columnAnalysis: [],
        updateVisualization,
      }),
    { initialProps: { current: encoding } },
  );
}

describe("useVisualizationEncodingChange", () => {
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
      firstWrite = result.current("color", "channel");
      await result.current("size", "orders");
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

  it("builds on the refreshed encoding once writes have settled", async () => {
    const updateVisualization = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderEncodingHook(
      { y: "revenue" },
      updateVisualization,
    );

    await act(async () => {
      await result.current("color", "channel");
    });
    rerender({ current: { y: "orders", color: "region" } });
    await act(async () => {
      await result.current("size", "count");
    });

    expect(updateVisualization).toHaveBeenLastCalledWith({
      id: visualizationId,
      updates: {
        encoding: { y: "orders", color: "region", size: "count" },
      },
    });
  });
});
