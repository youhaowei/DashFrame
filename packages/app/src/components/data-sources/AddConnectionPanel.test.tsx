/**
 * Regression test for AddConnectionPanel's registry-hydration race.
 *
 * `useConnectorCatalog()` (TanStack Query) resolves independently of
 * ConnectorSetup's hydration effect, which populates the module-scope
 * connector registry via `hydrateConnectorRegistry()` AFTER its own first
 * render. `getConnectorById()` reads that module-scope map directly, so a
 * naive `useMemo(..., [catalog])` never recomputes once hydration lands
 * after the catalog query already resolved (`catalog`'s object identity is
 * stable across renders) — the panel would then render permanently empty.
 *
 * This test reproduces exactly that ordering: catalog resolved, registry
 * still empty at mount, hydration happens afterward — and asserts the panel
 * picks up the newly-registered connector via `useRegistryVersion()`.
 */
import { localFileConnector } from "@dashframe/connector-local";
import type { ConnectorCatalogEntry } from "@dashframe/types";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  clearConnectorRegistry,
  hydrateConnectorRegistry,
} from "@/lib/connectors/registry";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockUseConnectorCatalog } = vi.hoisted(() => ({
  mockUseConnectorCatalog: vi.fn(),
}));

vi.mock("@/data/connector-catalog", () => ({
  useConnectorCatalog: () => mockUseConnectorCatalog(),
}));

// Stub the card renderer — this test is about registry reactivity, not the
// card's own rendering, and the real renderer pulls in far more than a unit
// test needs.
vi.mock("./renderers", () => ({
  ConnectorCardWithForm: ({
    connector,
  }: {
    connector: { id: string; name: string };
  }) => <div data-testid={`connector-${connector.id}`}>{connector.name}</div>,
}));

import { AddConnectionPanel } from "./AddConnectionPanel";

const CATALOG: ConnectorCatalogEntry[] = [
  {
    id: "local",
    name: localFileConnector.name,
    description: localFileConnector.description,
    sourceType: "file",
    icon: localFileConnector.icon,
    authKind: "none",
    formFields: [],
    accept: localFileConnector.accept,
    maxSizeMB: localFileConnector.maxSizeMB,
    helperText: localFileConnector.helperText,
  },
];

function renderPanel() {
  return render(
    <AddConnectionPanel
      onFileSelect={vi.fn()}
      onConnect={vi.fn().mockResolvedValue(undefined)}
      onOAuthConnect={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("AddConnectionPanel — registry hydration race (B1)", () => {
  beforeEach(() => {
    clearConnectorRegistry();
    mockUseConnectorCatalog.mockReset();
  });

  it("renders the connector once the registry hydrates AFTER the catalog query has already resolved", () => {
    // Catalog resolved (stable object identity), but ConnectorSetup's
    // hydration effect has not run yet — the exact race the bug depended on.
    mockUseConnectorCatalog.mockReturnValue({
      data: CATALOG,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPanel();

    // Registry is still empty at this point — no connector card yet, and the
    // panel must say so rather than silently rendering nothing.
    expect(screen.queryByTestId("connector-local")).toBeNull();
    expect(screen.getByText(/no connectors are available/i)).not.toBeNull();

    // Hydration lands — the same call ConnectorSetup's effect makes, using
    // the SAME catalog reference the panel already received (proves the fix
    // isn't just riding a `catalog` identity change).
    act(() => {
      hydrateConnectorRegistry(CATALOG, { local: () => localFileConnector });
    });

    expect(screen.getByTestId("connector-local")).not.toBeNull();
    expect(screen.queryByText(/no connectors are available/i)).toBeNull();
  });

  it("shows a loading state while the catalog query is in flight", () => {
    mockUseConnectorCatalog.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPanel();

    expect(screen.getByText(/loading connectors/i)).not.toBeNull();
  });

  it("shows an error state with a working retry action when the catalog query fails", () => {
    const refetch = vi.fn();
    mockUseConnectorCatalog.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("network down"),
      refetch,
    });

    renderPanel();

    expect(screen.getByText(/failed to load connectors/i)).not.toBeNull();
    screen.getByRole("button", { name: /retry/i }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
