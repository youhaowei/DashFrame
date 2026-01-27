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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateInsight } from "./useCreateInsight";

// Mock functions must be hoisted with vi.mock
const { mockCreateInsight, mockGetInsight, mockMutations } = vi.hoisted(() => {
  const create = vi.fn();
  return {
    mockCreateInsight: create,
    mockGetInsight: vi.fn(),
    mockMutations: { create },
  };
});

vi.mock("@dashframe/core", () => ({
  useInsightMutations: () => mockMutations,
  getInsight: mockGetInsight,
}));

const { mockPush, mockRouter } = vi.hoisted(() => {
  const push = vi.fn();
  return {
    mockPush: push,
    mockRouter: { push },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

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
    baseTableId: options.baseTableId ?? "table-abc",
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
        { selectedFields: [] }, // Empty for draft state
      );
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

    it("should create draft insight with empty selectedFields", async () => {
      mockCreateInsight.mockResolvedValue("draft-insight-001");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable(
          "table-orders",
          "Orders Analysis",
        );
      });

      // Verify the third argument (options) has empty selectedFields
      const callArgs = mockCreateInsight.mock.calls[0];
      expect(callArgs[2]).toEqual({ selectedFields: [] });
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
        { selectedFields: [] },
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
      });
    });

    it("should handle creation errors by propagating them", async () => {
      mockCreateInsight.mockRejectedValue(new Error("Database error"));

      const { result } = renderHook(() => useCreateInsight());

      await expect(async () => {
        await act(async () => {
          await result.current.createInsightFromTable(
            "table-fail",
            "Fail Test",
          );
        });
      }).rejects.toThrow("Database error");
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

    it("should create derived insight with same base table", async () => {
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
        "table-orders", // Same baseTableId as source
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
        "table-customers",
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

    it("should handle getInsight errors by propagating them", async () => {
      mockGetInsight.mockRejectedValue(new Error("Fetch error"));

      const { result } = renderHook(() => useCreateInsight());

      await expect(async () => {
        await act(async () => {
          await result.current.createInsightFromInsight(
            "error-123",
            "Error Test",
          );
        });
      }).rejects.toThrow("Fetch error");
    });

    it("should handle createInsight errors after successful fetch", async () => {
      const sourceInsight = createMockInsight({
        id: "source-fail",
        baseTableId: "table-fail",
      });

      mockGetInsight.mockResolvedValue(sourceInsight);
      mockCreateInsight.mockRejectedValue(new Error("Creation failed"));

      const { result } = renderHook(() => useCreateInsight());

      await expect(async () => {
        await act(async () => {
          await result.current.createInsightFromInsight(
            "source-fail",
            "Source Fail",
          );
        });
      }).rejects.toThrow("Creation failed");
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
        "table-nested",
        { selectedFields: [] },
      );
    });
  });

  describe("integration scenarios", () => {
    it("should create multiple insights from same table", async () => {
      mockCreateInsight
        .mockResolvedValueOnce("insight-1")
        .mockResolvedValueOnce("insight-2");

      const { result } = renderHook(() => useCreateInsight());

      await act(async () => {
        await result.current.createInsightFromTable("table-shared", "First");
        await result.current.createInsightFromTable("table-shared", "Second");
      });

      expect(mockCreateInsight).toHaveBeenCalledTimes(2);
      expect(mockPush).toHaveBeenCalledWith("/insights/insight-1");
      expect(mockPush).toHaveBeenCalledWith("/insights/insight-2");
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
