import { nativeMutationMock } from "@/test/native-query-fixture";
/**
 * useCreateInsight — the insight a new chart is built on.
 *
 * - Always a new, empty insight on the table, named after it.
 * - A name already taken on that table gets the first free numeric suffix.
 * - A failure toasts and resolves to null instead of rejecting.
 */
import type { UUID } from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockCommitBatch, mockGetAllInsights, mockToastError } = vi.hoisted(
  () => ({
    mockCommitBatch: vi.fn(),
    mockGetAllInsights: vi.fn(),
    mockToastError: vi.fn(),
  }),
);

vi.mock("@/lib/data-access/insights", () => ({
  getAllInsights: mockGetAllInsights,
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { useCreateInsight } from "./useCreateInsight";

type Command = { path: string; args: Record<string, unknown> };

function insightOn(tableId: string, name: string) {
  return { name, source: { sourceType: "dataTable", sourceId: tableId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllInsights.mockResolvedValue([]);
  mockCommitBatch.mockImplementation(
    async ({ commands }: { commands: Command[] }) => ({
      commands,
      results: [{ value: { id: commands[0]!.args.id } }],
    }),
  );
});

async function create(tableId = "table-1", tableName = "orders") {
  const { result } = renderHook(() => useCreateInsight());
  let id: string | null = null;
  await act(async () => {
    id = await result.current.createChartInsight(
      tableId,
      tableName,
      "insight-new" as UUID,
    );
  });
  const commands = mockCommitBatch.mock.calls.map(
    ([batch]) => (batch as { commands: Command[] }).commands[0]!,
  );
  return { id, commands };
}

describe("useCreateInsight — createChartInsight", () => {
  it("creates an empty insight on the table, named after it", async () => {
    const { id, commands } = await create();

    expect(commands).toHaveLength(1);
    expect(commands[0]!.path).toBe("createInsightCmd");
    expect(commands[0]!.args).toMatchObject({
      id: "insight-new",
      name: "orders",
      source: { sourceType: "dataTable", sourceId: "table-1" },
      selectedFields: [],
    });
    expect(id).toBe(commands[0]!.args.id);
  });

  it("takes the first free suffix among that table's insights only", async () => {
    mockGetAllInsights.mockResolvedValue([
      insightOn("table-1", "orders"),
      insightOn("table-1", "orders (3)"),
      insightOn("table-2", "orders (2)"),
    ]);

    const { commands } = await create();

    expect(commands[0]!.args.name).toBe("orders (2)");
  });

  it("toasts and resolves to null when the insight cannot be created", async () => {
    mockCommitBatch.mockRejectedValue(new Error("write failed"));

    const { id } = await create();

    expect(id).toBeNull();
    expect(mockToastError).toHaveBeenCalledWith("Couldn't start the chart");
  });
});
