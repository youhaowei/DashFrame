import {
  nativeMutationMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
/**
 * Unit tests for useCreateInsight hook
 *
 * Tests cover:
 * - Creating insights from data tables
 * - Creating derived insights from existing insights
 * - Navigation after insight creation
 * - Error handling for missing source insights
 * - Mock dependency injection for core hooks and router
 */
import type { Insight } from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useCreateInsight } from "./useCreateInsight";

// Mock functions must be hoisted with vi.mock
const {
  mockCreateInsight,
  mockCommitBatchMutation,
  mockGetInsight,
  mockGetAllInsights,
} = vi.hoisted(() => {
  const create = vi.fn();
  const commitMutation = vi.fn(
    async ({
      commands,
    }: {
      commands: Array<{ path: string; args: unknown }>;
    }) => {
      const command = commands[0];
      if (
        !command ||
        typeof command.args !== "object" ||
        command.args === null ||
        !("name" in command.args) ||
        !("source" in command.args) ||
        typeof command.args.name !== "string" ||
        typeof command.args.source !== "object" ||
        command.args.source === null ||
        !("sourceId" in command.args.source) ||
        typeof command.args.source.sourceId !== "string"
      ) {
        throw new Error("Unexpected insight command");
      }
      const selectedFields =
        "selectedFields" in command.args &&
        Array.isArray(command.args.selectedFields)
          ? command.args.selectedFields
          : [];
      const reuseUnmodifiedDraft = command.path === "getOrCreateInsightDraft";
      const id = await create(command.args.name, command.args.source.sourceId, {
        selectedFields,
        ...(reuseUnmodifiedDraft ? { reuseUnmodifiedDraft: true } : {}),
      });
      return { commands, results: [{ value: { id } }] };
    },
  );
  return {
    mockCreateInsight: create,
    mockCommitBatchMutation: commitMutation,
    mockGetInsight: vi.fn(),
    mockGetAllInsights: vi.fn(),
  };
});

vi.mock("@/lib/data-access/insights", () => ({
  getInsight: mockGetInsight,
  getAllInsights: mockGetAllInsights,
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: nativeMutationMock((ref: { _path: string }) => {
    if (ref._path === "commitBatch") {
      return { mutateAsync: mockCommitBatchMutation };
    }
    throw new Error(`Unexpected mutation: ${ref._path}`);
  }),
}));
vi.mock("@/data/host", () => ({
  useHostMutation: hostMutationMock((ref: { _path: string }) => {
    if (ref._path === "commitBatch") {
      return { mutateAsync: mockCommitBatchMutation };
    }
    throw new Error(`Unexpected mutation: ${ref._path}`);
  }),
}));

const { mockPush, mockNavigate } = vi.hoisted(() => {
  const push = vi.fn();
  const navigate = (opts: { to: string }) => push(opts.to);
  return { mockPush: push, mockNavigate: navigate };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

const SELECTED_FIELD_IDS = ["field-a", "field-b"];

/**
 * Helper to create a mock Insight object
 */
function createMockInsight(options: {
  id?: string;
  name?: string;
  baseTableId?: string;
  selectedFields?: string[];
}): Insight {
  return {
    id: options.id ?? "insight-123",
    name: options.name ?? "Test Insight",
    source: {
      sourceType: "dataTable",
      sourceId: options.baseTableId ?? "table-abc",
    },
    selectedFields: options.selectedFields ?? [],
    metrics: [],
    joins: [],
    filters: [],
    sorts: [],
    createdAt: Date.parse("2024-01-01T00:00:00.000Z"),
    updatedAt: Date.parse("2024-01-01T00:00:00.000Z"),
  };
}

describe("useCreateInsight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no pre-existing insights.
    mockGetAllInsights.mockResolvedValue([]);
  });

  describe("createInsightFromTable", () => {
    it("should create insight with table ID and name", async () => {
      mockCreateInsight.mockResolvedValue("new-insight-123");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-abc", "Sales Data");
      });

      expect(mockCreateInsight).toHaveBeenCalledWith(
        "Sales Data", // name
        "table-abc", // baseTableId
        { selectedFields: [], reuseUnmodifiedDraft: true },
      );
      expect(mockCommitBatchMutation).toHaveBeenCalledWith({
        commands: [
          expect.objectContaining({
            path: "getOrCreateInsightDraft",
            args: expect.objectContaining({
              name: "Sales Data",
              source: { sourceType: "dataTable", sourceId: "table-abc" },
            }),
          }),
        ],
      });
    });

    it("should navigate to the new insight page", async () => {
      mockCreateInsight.mockResolvedValue("new-insight-456");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable(
          "table-xyz",
          "Customer Data",
        );
      });

      expect(mockPush).toHaveBeenCalledWith("/insights/new-insight-456");
    });

    it("should return the created insight ID", async () => {
      mockCreateInsight.mockResolvedValue("created-insight-789");

      const { result } = renderHook(() => useCreateInsight());

      let insightId: string | null = null;
      await act(async () => {
        insightId = await result.current.createInsightFromTable(
          "table-123",
          "Revenue Report",
        );
      });

      expect(insightId).toBe("created-insight-789");
    });

    it("should create an EMPTY draft — no fields preselected", async () => {
      // Empty selectedFields is load-bearing: it keeps the draft eligible for
      // the server's unmodified-draft reuse gate, and the engine's unconfigured
      // fallback shows raw rows (preselecting fields would GROUP BY them and
      // collapse duplicate source rows).
      mockCreateInsight.mockResolvedValue("draft-insight-001");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable(
          "table-orders",
          "Orders Analysis",
        );
      });

      const callArgs = mockCreateInsight.mock.calls[0];
      expect(callArgs[2]).toEqual({
        selectedFields: [],
        reuseUnmodifiedDraft: true,
      });
    });

    it("should handle table names with special characters", async () => {
      mockCreateInsight.mockResolvedValue("insight-special");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable(
          "table-123",
          "Sales (2024) - Q1",
        );
      });

      expect(mockCreateInsight).toHaveBeenCalledWith(
        "Sales (2024) - Q1",
        "table-123",
        { selectedFields: [], reuseUnmodifiedDraft: true },
      );
    });

    it("should handle empty table name", async () => {
      mockCreateInsight.mockResolvedValue("insight-empty");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-empty", "");
      });

      expect(mockCreateInsight).toHaveBeenCalledWith("", "table-empty", {
        selectedFields: [],
        reuseUnmodifiedDraft: true,
      });
    });

    it("should surface creation errors as a toast and return null, not reject", async () => {
      mockCreateInsight.mockRejectedValue(new Error("Database error"));

      const { result } = renderHook(() => useCreateInsight());

      let insightId: string | null | undefined;
      await act(async () => {
        insightId = await result.current.createInsightFromTable(
          "table-fail",
          "Fail Test",
        );
      });

      expect(insightId).toBeNull();
      expect(mockToastError).toHaveBeenCalledWith("Couldn't create insight");
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("createInsightFromTable — naming", () => {
    it("should navigate to the id returned by core for the same source table", async () => {
      // The hook calls createInsight with the base name when no modified
      // same-table insight exists, and navigates to the id core returns.
      const existingDraft = createMockInsight({
        id: "existing-draft",
        name: "orders",
        baseTableId: "table-orders",
        selectedFields: [], // unmodified
      });

      mockGetAllInsights.mockResolvedValue([existingDraft]);
      mockCreateInsight.mockResolvedValue("existing-draft");

      const { result } = renderHook(() => useCreateInsight());

      let insightId: string | null = null;
      await act(async () => {
        insightId = await result.current.createInsightFromTable(
          "table-orders",
          "orders",
        );
      });

      // No suffix: only an unmodified empty insight exists for this table.
      expect(mockCreateInsight).toHaveBeenCalledWith("orders", "table-orders", {
        selectedFields: [],
        reuseUnmodifiedDraft: true,
      });
      expect(mockPush).toHaveBeenCalledWith("/insights/existing-draft");
      expect(insightId).toBe("existing-draft");
    });

    it("should create a new insight without suffix when no insights exist for the table", async () => {
      mockGetAllInsights.mockResolvedValue([]);
      mockCreateInsight.mockResolvedValue("new-draft");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-orders", "orders");
      });

      expect(mockCreateInsight).toHaveBeenCalledWith("orders", "table-orders", {
        selectedFields: [],
        reuseUnmodifiedDraft: true,
      });
      expect(mockPush).toHaveBeenCalledWith("/insights/new-draft");
    });

    it("should create a suffixed insight when an existing modified insight is present", async () => {
      const modifiedInsight = createMockInsight({
        id: "modified-insight",
        name: "orders",
        baseTableId: "table-orders",
        selectedFields: ["field-1"], // modified — has a selected field
      });

      mockGetAllInsights.mockResolvedValue([modifiedInsight]);
      mockCreateInsight.mockResolvedValue("new-draft-2");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-orders", "orders");
      });

      // A suffix is used rather than prompting — non-blocking, drive-feel.
      // The suffix path signals explicit new-insight intent, so reuse is OFF.
      expect(mockCreateInsight).toHaveBeenCalledWith(
        "orders (2)",
        "table-orders",
        { selectedFields: [] },
      );
      expect(mockPush).toHaveBeenCalledWith("/insights/new-draft-2");
    });

    it("should not reuse a modified insight that has filters set", async () => {
      const modifiedInsight = createMockInsight({
        id: "filtered-insight",
        name: "orders",
        baseTableId: "table-orders",
        selectedFields: [],
      });
      // Add a filter to mark it as modified
      modifiedInsight.filters = [
        { field: "status", operator: "eq", value: "active" },
      ];

      mockGetAllInsights.mockResolvedValue([modifiedInsight]);
      mockCreateInsight.mockResolvedValue("new-draft-filtered");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-orders", "orders");
      });

      expect(mockCreateInsight).toHaveBeenCalledWith(
        "orders (2)",
        "table-orders",
        { selectedFields: [] },
      );
    });

    it("should not consider a different source table when naming", async () => {
      const otherTableDraft = createMockInsight({
        id: "other-draft",
        name: "customers",
        baseTableId: "table-customers",
        selectedFields: [],
      });

      mockGetAllInsights.mockResolvedValue([otherTableDraft]);
      mockCreateInsight.mockResolvedValue("orders-draft");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-orders", "orders");
      });

      // The existing insight is for a different table — no suffix.
      expect(mockCreateInsight).toHaveBeenCalledWith("orders", "table-orders", {
        selectedFields: [],
        reuseUnmodifiedDraft: true,
      });
    });

    it("should find a gap-free suffix when an intermediate name was deleted", async () => {
      // Simulate: user had "orders", "orders (2)", "orders (3)"; deleted "orders (2)".
      // The next suffix should be "orders (2)" (fills the gap), not "orders (4)".
      const insight1 = createMockInsight({
        id: "i1",
        name: "orders",
        baseTableId: "table-orders",
        selectedFields: ["field-a"],
      });
      const insight3 = createMockInsight({
        id: "i3",
        name: "orders (3)",
        baseTableId: "table-orders",
        selectedFields: ["field-b"],
      });

      mockGetAllInsights.mockResolvedValue([insight1, insight3]);
      mockCreateInsight.mockResolvedValue("gap-fill-draft");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-orders", "orders");
      });

      expect(mockCreateInsight).toHaveBeenCalledWith(
        "orders (2)", // gap-free: (2) is missing, not (4)
        "table-orders",
        { selectedFields: [] },
      );
    });
  });

  describe("createInsightFromInsight", () => {
    it("should fetch the source insight", async () => {
      const sourceInsight = createMockInsight({
        id: "source-123",
        name: "Source Insight",
        baseTableId: "table-abc",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockResolvedValue("derived-123");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromInsight(
          "source-123",
          "Source Insight",
        );
      });

      expect(mockGetInsight).toHaveBeenCalledWith("source-123");
    });

    it("should create a derived insight over the source insight", async () => {
      const sourceInsight = createMockInsight({
        id: "source-456",
        name: "Original Analysis",
        baseTableId: "table-orders",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockResolvedValue("derived-456");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromInsight(
          "source-456",
          "Original Analysis",
        );
      });

      expect(mockCreateInsight).toHaveBeenCalledWith(
        "Original Analysis (derived)",
        "source-456",
        { selectedFields: [] },
      );
    });

    it("should append '(derived)' to the source insight name", async () => {
      const sourceInsight = createMockInsight({
        id: "source-789",
        name: "Customer Segmentation",
        baseTableId: "table-customers",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockResolvedValue("derived-789");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromInsight(
          "source-789",
          "Customer Segmentation",
        );
      });

      expect(mockCreateInsight).toHaveBeenCalledWith(
        "Customer Segmentation (derived)",
        "source-789",
        { selectedFields: [] },
      );
    });

    it("should navigate to the new derived insight", async () => {
      const sourceInsight = createMockInsight({
        id: "source-111",
        baseTableId: "table-111",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockResolvedValue("derived-999");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromInsight("source-111", "Source");
      });

      expect(mockPush).toHaveBeenCalledWith("/insights/derived-999");
    });

    it("should return the derived insight ID", async () => {
      const sourceInsight = createMockInsight({
        id: "source-222",
        baseTableId: "table-222",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockResolvedValue("derived-222");

      const { result } = renderHook(() => useCreateInsight());

      let insightId: string | null = null;
      await act(async () => {
        insightId = await result.current.createInsightFromInsight(
          "source-222",
          "Source Name",
        );
      });

      expect(insightId).toBe("derived-222");
    });

    it("should return null when source insight is not found", async () => {
      mockGetInsight.mockResolvedValue(null);

      const { result } = renderHook(() => useCreateInsight());

      let insightId: string | null | undefined;
      await act(async () => {
        insightId = await result.current.createInsightFromInsight(
          "non-existent",
          "Missing",
        );
      });

      expect(insightId).toBeNull();
    });

    it("should not create insight when source is not found", async () => {
      mockGetInsight.mockResolvedValue(null);

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromInsight("missing-123", "Missing");
      });

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it("should not navigate when source insight is not found", async () => {
      mockGetInsight.mockResolvedValue(null);

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromInsight("missing-456", "Missing");
      });

      expect(mockPush).not.toHaveBeenCalled();
    });

    it("should surface getInsight errors as a toast and return null, not reject", async () => {
      mockGetInsight.mockRejectedValue(new Error("Fetch error"));

      const { result } = renderHook(() => useCreateInsight());

      let insightId: string | null | undefined;
      await act(async () => {
        insightId = await result.current.createInsightFromInsight(
          "error-123",
          "Error Test",
        );
      });

      expect(insightId).toBeNull();
      expect(mockToastError).toHaveBeenCalledWith("Couldn't create insight");
    });

    it("should surface createInsight errors after successful fetch as a toast", async () => {
      const sourceInsight = createMockInsight({
        id: "source-fail",
        baseTableId: "table-fail",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockRejectedValue(new Error("Creation failed"));

      const { result } = renderHook(() => useCreateInsight());

      let insightId: string | null | undefined;
      await act(async () => {
        insightId = await result.current.createInsightFromInsight(
          "source-fail",
          "Source Fail",
        );
      });

      expect(insightId).toBeNull();
      expect(mockToastError).toHaveBeenCalledWith("Couldn't create insight");
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("should handle source insight names with '(derived)' already in them", async () => {
      const sourceInsight = createMockInsight({
        id: "source-nested",
        name: "Original (derived)",
        baseTableId: "table-nested",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockResolvedValue("derived-nested");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromInsight(
          "source-nested",
          "Original (derived)",
        );
      });

      // Should still append '(derived)', even if it already exists
      expect(mockCreateInsight).toHaveBeenCalledWith(
        "Original (derived) (derived)",
        "source-nested",
        { selectedFields: [] },
      );
    });
  });

  describe("integration scenarios", () => {
    it("should suffix a second table-created insight once the first is configured", async () => {
      // First call — no existing insights, creates a new empty draft.
      mockGetAllInsights.mockResolvedValueOnce([]);
      mockCreateInsight.mockResolvedValueOnce("insight-1");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-shared", "Orders");
      });

      expect(mockCreateInsight).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith("/insights/insight-1");

      vi.clearAllMocks();

      // Second call for the SAME table — the first draft has since been
      // configured (selectedFields below makes it a MODIFIED insight), so
      // the hook computes the next display suffix.
      const existingDraft = createMockInsight({
        id: "insight-1",
        name: "Orders",
        baseTableId: "table-shared",
        selectedFields: SELECTED_FIELD_IDS,
      });
      mockGetAllInsights.mockResolvedValueOnce([existingDraft]);
      mockCreateInsight.mockResolvedValueOnce("insight-2");

      let secondId: string | null = null;
      await act(async () => {
        secondId = await result.current.createInsightFromTable(
          "table-shared",
          "Orders",
        );
      });

      expect(mockCreateInsight).toHaveBeenCalledWith(
        "Orders (2)",
        "table-shared",
        {
          selectedFields: [],
        },
      );
      expect(mockPush).toHaveBeenCalledWith("/insights/insight-2");
      expect(secondId).toBe("insight-2");
    });

    it("should create insight chain (table → insight → derived)", async () => {
      const sourceInsight = createMockInsight({
        id: "chain-source",
        baseTableId: "table-chain",
      });

      mockCreateInsight
        .mockResolvedValueOnce("chain-source")
        .mockResolvedValueOnce("chain-derived");
      mockGetInsight.mockResolvedValue(sourceInsight);

      const { result } = renderHook(() => useCreateInsight());

      // Step 1: Create from table
      await act(async () => {
        await result.current.createInsightFromTable(
          "table-chain",
          "Original Analysis",
        );
      });

      // Step 2: Create derived from first insight
      await act(async () => {
        await result.current.createInsightFromInsight(
          "chain-source",
          "Original Analysis",
        );
      });

      expect(mockCreateInsight).toHaveBeenCalledTimes(2);
      expect(mockGetInsight).toHaveBeenCalledWith("chain-source");
    });

    it("should handle rapid sequential calls", async () => {
      mockCreateInsight
        .mockResolvedValueOnce("rapid-1")
        .mockResolvedValueOnce("rapid-2")
        .mockResolvedValueOnce("rapid-3");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await Promise.all([
          result.current.createInsightFromTable("table-1", "Analysis 1"),
          result.current.createInsightFromTable("table-2", "Analysis 2"),
          result.current.createInsightFromTable("table-3", "Analysis 3"),
        ]);
      });

      expect(mockCreateInsight).toHaveBeenCalledTimes(3);
      expect(mockPush).toHaveBeenCalledTimes(3);
    });

    it("should navigate both concurrent calls to the ids returned by core", async () => {
      // Both calls fire before either resolves, so both getAllInsights() calls
      // return [] and the hook sends both creates with the base name.
      mockGetAllInsights.mockResolvedValue([]);
      // Both calls hit the server; the server's transaction returns the same id.
      mockCreateInsight.mockResolvedValue("converged-draft");

      const { result } = renderHook(() => useCreateInsight());

      const [id1, id2] = await act(async () => {
        return Promise.all([
          result.current.createInsightFromTable("table-orders", "orders"),
          result.current.createInsightFromTable("table-orders", "orders"),
        ]);
      });

      // Both calls should resolve to the same id (server converges them).
      expect(id1).toBe("converged-draft");
      expect(id2).toBe("converged-draft");
      // Both calls made it to the server — dedup is server-side, not skipped.
      expect(mockCreateInsight).toHaveBeenCalledTimes(2);
      // Both navigations target the same id.
      expect(mockPush).toHaveBeenCalledTimes(2);
      expect(mockPush).toHaveBeenNthCalledWith(1, "/insights/converged-draft");
      expect(mockPush).toHaveBeenNthCalledWith(2, "/insights/converged-draft");
    });
  });

  describe("hook stability", () => {
    it("should return stable function references", () => {
      const { result, rerender } = renderHook(() => useCreateInsight());

      const firstCreateFromTable = result.current.createInsightFromTable;
      const firstCreateFromInsight = result.current.createInsightFromInsight;

      rerender();

      // Functions should be the same reference (memoized with useCallback)
      expect(result.current.createInsightFromTable).toBe(firstCreateFromTable);
      expect(result.current.createInsightFromInsight).toBe(
        firstCreateFromInsight,
      );
    });

    it("should not recreate functions on unrelated rerenders", () => {
      const { result, rerender } = renderHook(() => useCreateInsight());

      const originalFunctions = { ...result.current };

      // Trigger multiple rerenders
      rerender();
      rerender();
      rerender();

      expect(result.current.createInsightFromTable).toBe(
        originalFunctions.createInsightFromTable,
      );
      expect(result.current.createInsightFromInsight).toBe(
        originalFunctions.createInsightFromInsight,
      );
    });
  });

  describe("type safety", () => {
    it("should return correct types for createInsightFromTable", async () => {
      mockCreateInsight.mockResolvedValue("type-test-123");

      const { result } = renderHook(() => useCreateInsight());

      let returnValue: string | null = null;
      await act(async () => {
        returnValue = await result.current.createInsightFromTable(
          "table-type",
          "Type Test",
        );
      });

      // Should return string (insight ID)
      expect(typeof returnValue).toBe("string");
      expect(returnValue).toBe("type-test-123");
    });

    it("should return correct types for createInsightFromInsight", async () => {
      const sourceInsight = createMockInsight({
        id: "type-source",
        baseTableId: "table-type",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockResolvedValue("type-derived-123");

      const { result } = renderHook(() => useCreateInsight());

      let returnValue: string | null = null;
      await act(async () => {
        returnValue = await result.current.createInsightFromInsight(
          "type-source",
          "Type Source",
        );
      });

      // Should return string | null (insight ID or null if source not found)
      expect(typeof returnValue).toBe("string");
      expect(returnValue).toBe("type-derived-123");
    });

    it("should return null type for missing source insight", async () => {
      mockGetInsight.mockResolvedValue(null);

      const { result } = renderHook(() => useCreateInsight());

      let returnValue: string | null | undefined;
      await act(async () => {
        returnValue = await result.current.createInsightFromInsight(
          "missing",
          "Missing",
        );
      });

      expect(returnValue).toBeNull();
    });
  });
});
