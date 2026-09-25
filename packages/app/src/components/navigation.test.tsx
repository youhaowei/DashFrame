import { nativeQueryMock, hostQueryMock } from "@/test/native-query-fixture";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useCommandPalette } from "@/components/shell/command-palette-store";

const { mockLocation, mockPlatform } = vi.hoisted(() => ({
  mockLocation: { pathname: "/data-sources" },
  mockPlatform: { hasInsetTrafficLights: false },
}));

vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/perf", () => ({ PerfHud: () => null }));
vi.mock("@/components/shelf/NavShelf", () => ({ ShelfPanel: () => null }));
vi.mock("@/lib/platform", () => ({ usePlatform: () => mockPlatform }));
vi.mock("@/lib/stores/shell-store", () => ({
  useShellStore: (select: (state: { leftNavOpen: boolean }) => unknown) =>
    select({ leftNavOpen: true }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => ({
    data: ref._path === "listDraftCount" ? 0 : [],
  })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock(() => ({ data: [] })),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, onClick, children, ...props }: React.ComponentProps<"a">) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
  useLocation: ({
    select,
  }: { select?: (location: { pathname: string }) => unknown } = {}) =>
    select ? select(mockLocation) : mockLocation,
}));
vi.mock("@wystack/ui-react", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    label,
    children,
    onClick,
  }: {
    label?: string;
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children ?? label}
    </button>
  ),
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="mobile-drawer">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Dock: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Surface: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));
vi.mock("@wystack/ui-react/icons", () => ({
  CloseIcon: () => null,
  DashboardIcon: () => null,
  DatabaseIcon: () => null,
  FileIcon: () => null,
  GithubIcon: () => null,
  GridIcon: () => null,
  MenuIcon: () => null,
  SearchIcon: () => null,
  SettingsIcon: () => null,
  SparklesIcon: () => null,
}));

import { Navigation } from "./navigation";

describe("Navigation", () => {
  beforeEach(() => {
    mockLocation.pathname = "/data-sources";
    mockPlatform.hasInsetTrafficLights = false;
  });

  it("renders exactly the three ratified roots in order", () => {
    render(<Navigation />);

    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Reports",
      "Data Sources",
      "Drafts",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboards",
      "/data-sources",
      "/drafts",
    ]);
  });

  it("opens the command palette from the search row above the roots, closing the drawer", () => {
    useCommandPalette.setState({ open: false });
    render(<Navigation />);
    const nav = screen.getByRole("navigation");
    const search = within(nav).getByRole("button", { name: /^Search…/ });
    expect(
      search.compareDocumentPosition(within(nav).getAllByRole("link")[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByTestId("mobile-drawer");
    fireEvent.click(within(drawer).getByRole("button", { name: /^Search…/ }));
    expect(useCommandPalette.getState().open).toBe(true);
    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
  });

  it("shows the DashFrame logo linking to Reports", () => {
    render(<Navigation />);

    const home = screen
      .getAllByRole("link")
      .find((link) => link.textContent?.trim() === "DashFrame");
    expect(home?.getAttribute("href")).toBe("/dashboards");
    expect(home?.querySelector("svg")).not.toBeNull();
  });

  it("keeps a draggable row for the traffic lights only on macOS desktop", () => {
    const { unmount } = render(<Navigation />);
    expect(screen.queryByTestId("nav-traffic-light-row")).toBeNull();
    unmount();

    mockPlatform.hasInsetTrafficLights = true;
    render(<Navigation />);
    expect(screen.getByTestId("nav-traffic-light-row").className).toContain(
      "titlebar-drag-region",
    );
  });

  it("closes the mobile drawer when the active route is tapped", () => {
    render(<Navigation />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByTestId("mobile-drawer")).toBeDefined();

    fireEvent.click(
      within(screen.getByTestId("mobile-drawer")).getByRole("link", {
        name: "Data Sources",
      }),
    );
    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
  });

  it("closes the mobile drawer when the pathname changes", () => {
    const { rerender } = render(<Navigation />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByTestId("mobile-drawer")).toBeDefined();

    mockLocation.pathname = "/drafts";
    rerender(<Navigation />);

    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
  });

  it("links Settings to the settings page, closing the drawer", () => {
    render(<Navigation />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByTestId("mobile-drawer");
    const settings = within(drawer).getByRole("link", { name: "Settings" });
    expect(settings.getAttribute("href")).toBe("/settings");

    fireEvent.click(settings);
    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
  });

  // Clearing data, credentials, and sign-out live on the Settings page now.
  it("keeps no settings menu in the nav", () => {
    render(<Navigation />);
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByText("Clear all data")).toBeNull();
    expect(screen.queryByText("Sign out")).toBeNull();
  });
});
