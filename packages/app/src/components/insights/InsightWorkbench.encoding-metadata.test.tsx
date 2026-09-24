import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";

const { useInsightPagination } = vi.hoisted(() => ({
  useInsightPagination: vi.fn(),
}));

vi.mock("@/hooks/useInsightPagination", () => ({
  resolveInsightSourceDataTable: vi.fn(),
  useInsightPagination,
}));

import { useInsightEncodingMetadata } from "./InsightWorkbench";

it("uses one rendered materialization for all saved-chart encoding metadata", () => {
  const retry = vi.fn();
  const metadata = {
    columns: [{ name: "region", type: "string" }],
    columnDisplayNames: { region: "Region" },
    resolvedFields: [{ id: "field-region", name: "Region" }],
    schema: [{ id: "region", name: "Region", type: "string" }],
    sampleRows: [{ region: "EMEA" }],
    totalCount: 12,
    isReady: true,
    error: "encoding failed",
    retry,
  };
  useInsightPagination.mockReturnValue(metadata);
  const insight = { id: "insight-1" } as never;

  const { result } = renderHook(() =>
    useInsightEncodingMetadata(insight, true),
  );

  expect(useInsightPagination).toHaveBeenCalledOnce();
  expect(useInsightPagination).toHaveBeenCalledWith({
    insight,
    showModelPreview: false,
    enabled: true,
  });
  expect(result.current).toBe(metadata);
  expect(result.current.retry).toBe(retry);
  expect(result.current.error).toBe("encoding failed");
});
