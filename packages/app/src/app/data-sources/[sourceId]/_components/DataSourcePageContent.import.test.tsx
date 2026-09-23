import {
  hostMutationMock,
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
/**
 * "Import file" on Local Files, through the real picker dialog: it offers
 * only file connectors, so it cannot create another source and hand this
 * page a table from it.
 */
import { localFileConnector } from "@dashframe/connector-local";
import type { AnyConnector } from "@dashframe/engine";
import type { ConnectorCatalogEntry, DataSource, UUID } from "@dashframe/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockUseConnectorCatalog } = vi.hoisted(() => ({
  mockUseConnectorCatalog: vi.fn(),
}));

const SOURCE_ID = "source-local" as UUID;
const LOCAL_SOURCE = {
  id: SOURCE_ID,
  name: "Local Files",
  type: "local",
  config: { hasApiKey: false, hasConnectionString: false },
  createdAt: 0,
} satisfies DataSource;

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listDataSources") return { data: [LOCAL_SOURCE] };
    if (ref._path === "listDataTables") return { data: [] };
    if (ref._path === "listDataFrames") return { data: [] };
    if (ref._path === "listInsights") return { data: [] };
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useMutation: nativeMutationMock(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/data/host", () => ({
  requestHost: vi.fn(),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/data/connector-catalog", () => ({
  useConnectorCatalog: () => mockUseConnectorCatalog(),
}));

// The connector cards are their own tested surface; here only which cards
// the picker offers matters.
vi.mock("@/components/data-sources/renderers", () => ({
  ConnectorCardWithForm: ({ connector }: { connector: { name: string } }) => (
    <button type="button">{connector.name}</button>
  ),
}));

vi.mock("@/hooks/useCreateInsight", () => ({
  useCreateInsight: () => ({ createInsightFromTable: vi.fn() }),
}));

vi.mock("@/hooks/useDataFrameData", () => ({
  useDataFrameData: () => ({
    data: null,
    isLoading: false,
    error: null,
    entry: undefined,
    reload: vi.fn(),
  }),
}));

vi.mock("@/components/layouts/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

import { TopBarTabsProvider } from "@/components/shell/topbar-tabs";
import {
  clearConnectorRegistry,
  hydrateConnectorRegistry,
} from "@/lib/connectors/registry";
import { PlatformProvider } from "@/lib/platform";
import DataSourcePageContent from "./DataSourcePageContent";

function remote(id: string, name: string): AnyConnector {
  return {
    id,
    name,
    description: name,
    sourceType: "remote-api",
    authKind: "form",
    icon: "",
  } as unknown as AnyConnector;
}

const CATALOG = [
  { id: "local", name: localFileConnector.name, sourceType: "file" },
  { id: "notion", name: "Notion", sourceType: "remote-api" },
  { id: "googleAnalytics", name: "Google Analytics", sourceType: "remote-api" },
] as ConnectorCatalogEntry[];

beforeEach(() => {
  clearConnectorRegistry();
  hydrateConnectorRegistry(CATALOG, {
    local: () => localFileConnector,
    notion: () => remote("notion", "Notion"),
    googleAnalytics: () => remote("googleAnalytics", "Google Analytics"),
  });
  mockUseConnectorCatalog.mockReturnValue({
    data: CATALOG,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe("DataSourcePageContent — Import file on Local Files", () => {
  it("offers only file connectors, never a remote source", async () => {
    render(
      <PlatformProvider>
        <TopBarTabsProvider>
          <DataSourcePageContent
            sourceId={SOURCE_ID}
            tableId={null}
            onSelectTable={vi.fn()}
          />
        </TopBarTabsProvider>
      </PlatformProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import file" }));

    const dialog = within(
      await screen.findByRole("dialog", { name: "Import a file" }),
    );
    dialog.getByRole("button", { name: localFileConnector.name });
    expect(dialog.queryByRole("button", { name: "Notion" })).toBeNull();
    expect(
      dialog.queryByRole("button", { name: "Google Analytics" }),
    ).toBeNull();
  });
});
