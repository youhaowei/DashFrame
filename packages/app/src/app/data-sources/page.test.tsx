import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockNavigate,
  mockRefetchDataSources,
  mockRefetchDataTables,
  mockUseDataSources,
  mockUseDataTables,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRefetchDataSources: vi.fn(),
  mockRefetchDataTables: vi.fn(),
  mockUseDataSources: vi.fn(),
  mockUseDataTables: vi.fn(),
}));

vi.mock("@/data", () => ({
  useDataSources: mockUseDataSources,
  useDataTables: mockUseDataTables,
  useDataSourceMutations: () => ({ remove: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/visualizations/CreateVisualizationModal", () => ({
  CreateVisualizationModal: () => null,
}));

import DataSourcesPage from "./page";

function successfulQuery(refetch: () => Promise<unknown>) {
  return {
    data: [],
    error: null,
    isError: false,
    isLoading: false,
    refetch,
  };
}

describe("DataSourcesPage query states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetchDataSources.mockResolvedValue(undefined);
    mockRefetchDataTables.mockResolvedValue(undefined);
    mockUseDataSources.mockReturnValue(successfulQuery(mockRefetchDataSources));
    mockUseDataTables.mockReturnValue(successfulQuery(mockRefetchDataTables));
  });

  it.each(["data sources", "data tables"])(
    "renders a retryable error instead of an empty state when fetching %s fails",
    async (failedQuery) => {
      const failure = {
        data: undefined,
        error: new Error("service unavailable"),
        isError: true,
        isLoading: false,
      };
      if (failedQuery === "data sources") {
        mockUseDataSources.mockReturnValue({
          ...failure,
          refetch: mockRefetchDataSources,
        });
      } else {
        mockUseDataTables.mockReturnValue({
          ...failure,
          refetch: mockRefetchDataTables,
        });
      }

      render(<DataSourcesPage />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Failed to load data sources")).not.toBeNull();
      expect(screen.queryByText("No data sources yet")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      await waitFor(() => {
        expect(mockRefetchDataSources).toHaveBeenCalledTimes(1);
        expect(mockRefetchDataTables).toHaveBeenCalledTimes(1);
      });
    },
  );

  it("renders the real empty state after both queries succeed", () => {
    render(<DataSourcesPage />);

    expect(screen.getByText("No data sources yet")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
