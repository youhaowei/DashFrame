import { nativeQueryMock, hostQueryMock } from "@/test/native-query-fixture";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useCommandPalette } from "@/components/shell/command-palette-store";

const { mockClearAllData, mockLocation, mockPlatform, mockReloadRoot } =
  vi.hoisted(() => ({
    mockClearAllData: vi.fn(),
    mockLocation: { pathname: "/data-sources" },
    mockPlatform: { hasInsetTrafficLights: false },
    mockReloadRoot: vi.fn(),
  }));

vi.mock("@/components/access-credentials/AccessCredentialsDialog", () => ({
  AccessCredentialsDialog: () => null,
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/data", () => ({
  useAccessCapabilities: () => ({ data: { canManageCredentials: false } }),
}));
vi.mock("@/lib/data-access/data-frames", () => ({
  clearAllData: mockClearAllData,
}));
vi.mock("@/lib/clear-all-data-navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clear-all-data-navigation")>()),
  reloadRootWithFreshWorkspaceState: mockReloadRoot,
}));
vi.mock("@/lib/perf", () => ({ PerfHud: () => null }));
vi.mock("@/components/shelf/NavShelf", () => ({ ShelfPanel: () => null }));
vi.mock("@/lib/platform", () => ({ usePlatform: () => mockPlatform }));
vi.mock("@/lib/stores", () => ({
  useToastStore: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
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
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Dock: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  Surface: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ render: trigger }: { render: React.ReactNode }) => (
    <>{trigger}</>
  ),
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));
vi.mock("@wystack/ui-react/icons", () => ({
  CloseIcon: () => null,
  DashboardIcon: () => null,
  DatabaseIcon: () => null,
  DeleteIcon: () => null,
  FileIcon: () => null,
  GithubIcon: () => null,
  GridIcon: () => null,
  MenuIcon: () => null,
  SearchIcon: () => null,
  SettingsIcon: () => null,
  SparklesIcon: () => null,
  UserIcon: () => null,
}));

import { SignOutProvider } from "@/bootstrap/sign-out";
import { Navigation } from "./navigation";

describe("Navigation", () => {
  beforeEach(() => {
    mockLocation.pathname = "/data-sources";
    mockPlatform.hasInsetTrafficLights = false;
    mockClearAllData.mockReset();
    mockClearAllData.mockResolvedValue(undefined);
    mockReloadRoot.mockReset();
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

  it("reloads the root with a fresh client after clear-all succeeds", async () => {
    render(<Navigation />);

    fireEvent.click(screen.getByRole("button", { name: "Clear all data" }));
    expect(screen.getByText("Clear all data?")).not.toBeNull();
    const clearButtons = screen.getAllByRole("button", {
      name: "Clear all data",
    });
    fireEvent.click(clearButtons.at(-1)!);

    await waitFor(() => expect(mockClearAllData).toHaveBeenCalledOnce());
    expect(mockReloadRoot).toHaveBeenCalledOnce();
  });

  it("offers sign out in the settings menu only when the host has accounts", () => {
    const onSignOut = vi.fn();
    const { unmount } = render(<Navigation />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    unmount();

    render(
      <SignOutProvider onSignOut={onSignOut}>
        <Navigation />
      </SignOutProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(
      within(screen.getByTestId("mobile-drawer")).getByRole("button", {
        name: "Sign out",
      }),
    );
    expect(onSignOut).toHaveBeenCalledTimes(2);
  });
});
