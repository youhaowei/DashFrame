/**
 * Route-level loading-state contract for DataSourcePageContent.
 *
 * Contract: when useDataSources is loading, the component shows a loading
 * indicator and NEVER shows "Data source not found" for a source that exists
 * in the resolved data. Once data arrives the content renders.
 *
 * This tests the fix for the hardcoded `const isLoading = false` bug: on
 * initial render allDataSources is empty until the store hydrates, so without
 * the real flag the component flashed "not found" before data arrived.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock helpers ──────────────────────────────────────────────────────────────

const { mockUseDataSources } = vi.hoisted(() => ({
  mockUseDataSources: vi.fn(),
}));

vi.mock("@dashframe/core", () => ({
  useDataSources: () => mockUseDataSources(),
  useDataSourceMutations: () => ({ update: vi.fn() }),
  useDataFrames: () => ({ data: [] }),
  useDataTableMutations: () => ({ remove: vi.fn(), updateField: vi.fn() }),
  useDataTables: () => ({ data: [] }),
}));

vi.mock("@/components/assistant/artifact-context", () => ({
  useBindArtifact: vi.fn(),
}));

vi.mock("@/hooks/useDataFrameData", () => ({
  useDataFrameData: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/lib/connectors/registry", () => ({
  getConnectorById: () => null,
}));

vi.mock("@/lib/perf", () => ({
  PerfStage: { CommandApply: "command-apply" },
  withPerfAsync: (_stage: unknown, fn: () => unknown) => fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@dashframe/engine", () => ({
  extractUUIDFromColumnAlias: () => null,
}));

vi.mock("@dashframe/types", () => ({
  buildSensitivityUpdate: vi.fn(),
  getFieldSensitivity: () => "unclassified",
  suggestSensitivityReasons: () => [],
}));

// Render AppLayout as a simple passthrough so children appear in the DOM.
vi.mock("@/components/layouts/AppLayout", () => ({
  AppLayout: ({
    children,
    headerContent,
    leftPanel,
  }: {
    children: React.ReactNode;
    headerContent?: React.ReactNode;
    leftPanel?: React.ReactNode;
  }) => (
    <div>
      {headerContent}
      {leftPanel}
      {children}
    </div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("@dashframe/ui", () => ({
  Breadcrumb: () => null,
  VirtualTable: () => null,
}));

// Stub UI components — only Button needs a real label so the "Go to Data Sources"
// button text shows up in the DOM for the not-found assertion.
vi.mock("@wystack/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <h3>{children}</h3>
  ),
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuTrigger: ({ render: r }: { render: React.ReactNode }) => <>{r}</>,
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={!onChange}
    />
  ),
  ItemCard: ({
    title,
    onClick,
  }: {
    title: string;
    onClick?: () => void;
    icon?: React.ReactNode;
    subtitle?: string;
    active?: boolean;
  }) => <button onClick={onClick}>{title}</button>,
}));

vi.mock("@wystack/ui-icons", () => ({
  DatabaseIcon: () => <span data-testid="db-icon" />,
  DeleteIcon: () => <span />,
  ChevronLeftIcon: () => <span />,
  MoreIcon: () => <span />,
  PlusIcon: () => <span />,
  TableIcon: () => <span data-testid="table-icon" />,
}));

vi.mock("@/components/data-sources/renderers/ConnectorIcon", () => ({
  ConnectorIcon: () => null,
}));

vi.mock("@/components/data-sources/SensitivityBadge", () => ({
  SensitivityBadge: () => null,
}));

// ── Component under test ──────────────────────────────────────────────────────

import React from "react";
import DataSourcePageContent from "./DataSourcePageContent";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SOURCE_ID = "source-abc-123" as import("@dashframe/types").UUID;
const DATA_SOURCE = {
  id: SOURCE_ID,
  name: "My Database",
  type: "csv",
  apiKey: null,
  connectionString: null,
} as import("@dashframe/types").DataSource;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataSourcePageContent — loading state contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading while useDataSources is fetching and then shows content — never 'not found'", async () => {
    // Start: loading, no data yet (store hasn't hydrated)
    mockUseDataSources.mockReturnValue({ data: [], isLoading: true });

    const { rerender } = render(<DataSourcePageContent sourceId={SOURCE_ID} />);

    // Loading indicator must be present (getByText throws if absent)
    screen.getByText("Loading data source…");

    // "not found" must NOT appear while loading
    expect(screen.queryByText("Data source not found")).toBeNull();

    // Resolve: data arrives, loading done
    mockUseDataSources.mockReturnValue({
      data: [DATA_SOURCE],
      isLoading: false,
    });

    await act(async () => {
      rerender(<DataSourcePageContent sourceId={SOURCE_ID} />);
    });

    // "not found" must never appear for a source that exists
    expect(screen.queryByText("Data source not found")).toBeNull();

    // The source name is rendered in the content (input value);
    // getByDisplayValue throws if absent
    screen.getByDisplayValue("My Database");
  });

  it("shows 'not found' only after loading completes and the source is genuinely absent", async () => {
    // Start: loading
    mockUseDataSources.mockReturnValue({ data: [], isLoading: true });

    const { rerender } = render(
      <DataSourcePageContent
        sourceId={"non-existent-id" as import("@dashframe/types").UUID}
      />,
    );

    // Not found must NOT flash during loading
    expect(screen.queryByText("Data source not found")).toBeNull();

    // Resolve: data arrives but this source isn't in it
    mockUseDataSources.mockReturnValue({
      data: [DATA_SOURCE],
      isLoading: false,
    });

    await act(async () => {
      rerender(
        <DataSourcePageContent
          sourceId={"non-existent-id" as import("@dashframe/types").UUID}
        />,
      );
    });

    // Now it's correct to show not-found — source really doesn't exist
    // (getByText throws if absent)
    screen.getByText("Data source not found");
  });
});
