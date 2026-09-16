import { nativeQueryMock } from "@/test/native-query-fixture";
/**
 * DataSourceSelector state contract.
 *
 * The selector renders three distinct outcomes: initial loading, a terminal
 * load error with a retry path, and the genuine "no data sources yet" empty
 * state. Regression for both queries resolving to the onboarding empty state
 * while pending or failed.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockUseDataSources, mockUseDataTables } = vi.hoisted(() => ({
  mockUseDataSources: vi.fn(),
  mockUseDataTables: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listDataSources") return mockUseDataSources();
    if (ref._path === "listDataTables") return mockUseDataTables();
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
}));

vi.mock("@/lib/connectors/registry", () => ({
  getConnectorById: () => ({
    id: "csv",
    sourceType: "file",
    icon: "<svg>csv</svg>",
  }),
  useRegistryVersion: () => 0,
}));

vi.mock("@/components/data-sources/renderers/ConnectorIcon", () => ({
  ConnectorIcon: () => <span />,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("@dashframe/ui", () => ({
  ItemSelector: ({
    items,
  }: {
    items: Array<{ id: string; label: string }>;
  }) => (
    <ul data-testid="item-selector">
      {items.map((item) => (
        <li key={item.id}>{item.label}</li>
      ))}
    </ul>
  ),
}));

vi.mock("@wystack/ui-react", () => ({
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  Surface: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@wystack/ui-react/icons", () => ({
  ChartIcon: () => <span />,
  DatabaseIcon: () => <span />,
  PlusIcon: () => <span />,
}));

import { DataSourceSelector } from "./DataSourceSelector";

const SOURCE = {
  id: "source-1",
  name: "My Database",
  type: "csv",
  createdAt: 0,
};

function renderSelector() {
  return render(
    <DataSourceSelector
      selectedId={null}
      onSelect={vi.fn()}
      onCreateClick={vi.fn()}
    />,
  );
}

const EMPTY_HEADING = "Add your first data source";
const ERROR_HEADING = "Couldn't load data sources";
const LOADING_TEXT = "Preparing data sources…";

describe("DataSourceSelector — loading, error, and empty states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDataSources.mockReturnValue({ data: [] });
    mockUseDataTables.mockReturnValue({ data: [] });
  });

  it("shows loading — not the empty state — while the sources query is pending", () => {
    mockUseDataSources.mockReturnValue({ isPending: true });

    renderSelector();

    screen.getByText(LOADING_TEXT);
    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
    expect(screen.queryByText(ERROR_HEADING)).toBeNull();
  });

  it("shows loading while only the tables query is pending, so counts are never wrong", () => {
    mockUseDataSources.mockReturnValue({ data: [SOURCE] });
    mockUseDataTables.mockReturnValue({ isPending: true });

    renderSelector();

    screen.getByText(LOADING_TEXT);
    expect(screen.queryByTestId("item-selector")).toBeNull();
  });

  it("shows a distinct error state with a retry control when the sources query fails", () => {
    mockUseDataSources.mockReturnValue({ isLoadingError: true });

    renderSelector();

    // The regression: a failed load previously rendered the onboarding empty
    // state, telling the user they have no data sources.
    screen.getByText(ERROR_HEADING);
    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
    screen.getByRole("button", { name: "Try again" });
  });

  it("shows the error state when only the tables query fails", () => {
    mockUseDataSources.mockReturnValue({ data: [SOURCE] });
    mockUseDataTables.mockReturnValue({ isLoadingError: true });

    renderSelector();

    screen.getByText(ERROR_HEADING);
    expect(screen.queryByTestId("item-selector")).toBeNull();
  });

  it("reloads the surface from the retry control", () => {
    mockUseDataSources.mockReturnValue({ isLoadingError: true });
    const reload = vi.fn();
    vi.spyOn(globalThis, "location", "get").mockReturnValue({
      reload,
    } as unknown as Location);

    renderSelector();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state only for a successful zero-source result", () => {
    mockUseDataSources.mockReturnValue({ data: [] });

    renderSelector();

    screen.getByText(EMPTY_HEADING);
    expect(screen.queryByText(ERROR_HEADING)).toBeNull();
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
  });

  it("lists sources once both queries succeed", () => {
    mockUseDataSources.mockReturnValue({ data: [SOURCE] });

    renderSelector();

    screen.getByText("My Database");
    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
  });
});
