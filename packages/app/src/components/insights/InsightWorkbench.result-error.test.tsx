import { nativeQueryMocks, hostQueryMock } from "@/test/native-query-fixture";
import type { Insight, UUID } from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { queryDataFrame, client, useQuery, runtime } = vi.hoisted(() => ({
  queryDataFrame: vi.fn(),
  client: { mutate: vi.fn() },
  useQuery: vi.fn(() => ({ data: [] })),
  runtime: { scope: {} as object },
}));

vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));
vi.mock("@/data/runtime", () => ({
  getConvexClient: () => client,
  getRuntimeConfig: () => runtime.scope,
  useQuery: () => ({ data: [] }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  ...nativeQueryMocks(useQuery),
}));
vi.mock("@/data/host", () => ({
  requestHost: (operation: string, args: unknown) =>
    client.mutate({ _path: operation }, args),
  useHostQuery: hostQueryMock(useQuery),
}));
vi.mock("@dashframe/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dashframe/ui")>()),
  VirtualTable: () => <div data-testid="result-table" />,
}));

import { useInsightPagination } from "@/hooks/useInsightPagination";
import { InsightResultTable, resultErrorCopy } from "./InsightWorkbench";

const tableId = "10000000-0000-4000-8000-000000000001" as UUID;
const fieldId = "10000000-0000-4000-8000-000000000002" as UUID;
const insight = {
  id: "10000000-0000-4000-8000-000000000003" as UUID,
  name: "Orders",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [fieldId],
  metrics: [],
  createdAt: 0,
} as Insight;

const NO_DATA_MESSAGE =
  "This insight couldn't be compiled. Its source table may not have data yet.";

function ResultTableHarness() {
  const result = useInsightPagination({
    insight,
    showModelPreview: false,
  });
  return <InsightResultTable result={result} />;
}

describe("resultErrorCopy", () => {
  it("keeps the host's copy and replaces runtime output", () => {
    expect(resultErrorCopy(NO_DATA_MESSAGE)).toBe(NO_DATA_MESSAGE);
    for (const raw of [
      'Binder Error: Referenced column "x" not found',
      "RuntimeError: unreachable\n    at wasm-function[42]",
      "TypeError: undefined is not a function (at query (engine.js:12))",
      "TypeError: Cannot read properties of undefined",
      "Error: Node abc not found",
    ]) {
      expect(resultErrorCopy(raw)).toBe(
        "The data for this chart couldn't be read. Try again, or check its data source.",
      );
    }
    // Plain words about an error are copy, not runtime output.
    const human = "Connection error: the host did not answer. Try again.";
    expect(resultErrorCopy(human)).toBe(human);
  });
});

describe("InsightResultTable data states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.scope = {};
  });

  it("shows the fetch error instead of 'Loading data...' when the run fails", async () => {
    client.mutate.mockResolvedValue({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message: NO_DATA_MESSAGE,
      retryable: false,
      diagnosticId: "diag-1",
    });

    render(<ResultTableHarness />);

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.getByText(NO_DATA_MESSAGE)).not.toBeNull();
    expect(screen.queryByText("Loading data...")).toBeNull();
    expect(screen.queryByTestId("result-table")).toBeNull();
  });
});
