/**
 * DataSourcePageContent tests.
 *
 * Section 1 — loading-state contract:
 *   When useDataSources is loading, the component shows a loading indicator and
 *   NEVER shows "Data source not found" for a source that exists in the resolved
 *   data. Once data arrives the content renders.
 *   (Regression for the hardcoded `const isLoading = false` bug.)
 *
 * Section 2 — buildAnalysisByFieldId repeat-join identity:
 *   Columns from a repeat-join have _j0 / _j1 suffixes on their aliases. The
 *   analysis map must store them under distinct keys so j1 cannot overwrite j0.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  extractColumnAliasComponents: vi.fn(() => null),
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

import { extractColumnAliasComponents } from "@dashframe/engine";
import React from "react";
import DataSourcePageContent, {
  buildAnalysisByFieldId,
} from "./DataSourcePageContent";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SOURCE_ID = "source-abc-123" as import("@dashframe/types").UUID;
const DATA_SOURCE = {
  id: SOURCE_ID,
  name: "My Database",
  type: "csv",
  config: { hasApiKey: false, hasConnectionString: false },
  createdAt: 0,
} satisfies import("@dashframe/types").DataSource;

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

  it("does not flash 'not found' during a background refetch (isFetching) when stale cache omits the source", async () => {
    // Cached data exists (isLoading false) but a post-invalidation refetch is
    // in flight (isFetching true) and the stale cache does not yet include this
    // source. This is the refetch window: not-found must NOT flash.
    mockUseDataSources.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: true,
    });

    const { rerender } = render(<DataSourcePageContent sourceId={SOURCE_ID} />);

    // Must show loading, not not-found, while the refetch is in flight
    screen.getByText("Loading data source…");
    expect(screen.queryByText("Data source not found")).toBeNull();

    // Refetch settles with the source present
    mockUseDataSources.mockReturnValue({
      data: [DATA_SOURCE],
      isLoading: false,
      isFetching: false,
    });

    await act(async () => {
      rerender(<DataSourcePageContent sourceId={SOURCE_ID} />);
    });

    // Content renders; not-found never appeared for the real source
    expect(screen.queryByText("Data source not found")).toBeNull();
    screen.getByDisplayValue("My Database");
  });
});

// ── buildAnalysisByFieldId — repeat-join identity ────────────────────────────
//
// Contract: two analysis columns for the same base field but different join
// instances (field_<uuid>_j0 and field_<uuid>_j1) must occupy DISTINCT map
// entries. j1 must never overwrite j0.

describe("buildAnalysisByFieldId — repeat-join identity", () => {
  // Stable UUID used across fixtures
  const UUID = "dd05ef4b-1234-5678-abcd-ef1234567890";
  const COL_J0 = `field_${UUID.replace(/-/g, "_")}`;
  const COL_J1 = `${COL_J0}_j1`;

  // Inline parser matching the real extractColumnAliasComponents behaviour.
  const realParser = (alias: string) => {
    const m = alias.match(/^(?:field|metric)_(.+)$/);
    if (!m) return null;
    const raw = m[1] ?? "";
    const inst = raw.match(/^(.+)_j(\d+)$/);
    const uuidRaw = inst ? (inst[1] ?? "") : raw;
    const instanceIndex = inst ? parseInt(inst[2] ?? "0", 10) : 0;
    const parts = uuidRaw.split("_");
    const uuid =
      parts.length === 5 ? parts.join("-") : uuidRaw.replace(/_/g, "-");
    return { uuid, instanceIndex };
  };

  beforeEach(() => {
    vi.mocked(extractColumnAliasComponents).mockImplementation(realParser);
  });

  afterEach(() => {
    vi.mocked(extractColumnAliasComponents).mockReturnValue(null);
  });

  it("maps j0 column to the bare UUID key", () => {
    const col = makeCol(COL_J0, 5);
    const map = buildAnalysisByFieldId([col]);
    expect(map.has(UUID)).toBe(true);
    expect(map.get(UUID)).toBe(col);
  });

  it("maps j1 column to <uuid>_j1 key — does NOT overwrite j0", () => {
    const j0 = makeCol(COL_J0, 5);
    const j1 = makeCol(COL_J1, 15);
    const map = buildAnalysisByFieldId([j0, j1]);

    expect(map.size).toBe(2);
    expect(map.get(UUID)).toBe(j0);
    expect(map.get(`${UUID}_j1`)).toBe(j1);
  });

  it("single-join (no _j suffix) — not regressed, uses bare UUID key", () => {
    const col = makeCol(COL_J0, 10);
    const map = buildAnalysisByFieldId([col]);

    expect(map.has(UUID)).toBe(true);
    expect(map.size).toBe(1);
    // Must NOT create a _j0 key
    expect(map.has(`${UUID}_j0`)).toBe(false);
  });

  it("prefers explicit fieldId over parsed columnName when fieldId is set", () => {
    const explicitId = "explicit-field-id";
    const col = { ...makeCol(COL_J0, 3), fieldId: explicitId };
    const map = buildAnalysisByFieldId([col]);

    expect(map.get(explicitId)).toBe(col);
    expect(map.has(UUID)).toBe(false); // not re-parsed
  });
});

// Minimal categorical ColumnAnalysis fixture.
function makeCol(
  columnName: string,
  cardinality: number,
): import("@dashframe/types").ColumnAnalysis {
  return {
    columnName,
    dataType: "string",
    semantic: "categorical",
    cardinality,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: [],
  };
}
