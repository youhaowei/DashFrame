import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockNavigate,
  mockRefetchDataSources,
  mockRefetchDataTables,
  mockRemoveDataSource,
  mockUseDataSources,
  mockUseDataTables,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRefetchDataSources: vi.fn(),
  mockRefetchDataTables: vi.fn(),
  mockRemoveDataSource: vi.fn(),
  mockUseDataSources: vi.fn(),
  mockUseDataTables: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => {
      if (ref._path === "listDataSources") return mockUseDataSources();
      if (ref._path === "listDataTables") return mockUseDataTables();
      throw new Error(`Unexpected query: ${ref._path}`);
    },
    useMutation: (ref: { _path: string }) => {
      if (ref._path === "removeDataSource") {
        return { mutateAsync: mockRemoveDataSource };
      }
      throw new Error(`Unexpected mutation: ${ref._path}`);
    },
  };
});

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
    mockRemoveDataSource.mockResolvedValue({ ok: true });
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

  it("passes the reshaped id object to the remove mutation", async () => {
    mockUseDataSources.mockReturnValue({
      ...successfulQuery(mockRefetchDataSources),
      data: [
        {
          id: "source-123",
          name: "Local Files",
          type: "local",
          config: { hasApiKey: false, hasConnectionString: false },
          createdAt: 0,
        },
      ],
    });

    render(<DataSourcesPage />);

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    await waitFor(() => {
      expect(mockRemoveDataSource).toHaveBeenCalledWith({ id: "source-123" });
    });
  });
});
