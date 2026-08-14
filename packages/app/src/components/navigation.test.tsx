import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockLocation } = vi.hoisted(() => ({
  mockLocation: { pathname: "/data-sources" },
}));

vi.mock("@/components/access-credentials/AccessCredentialsDialog", () => ({
  AccessCredentialsDialog: () => null,
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/data", () => ({
  useAccessCapabilities: () => ({ data: { canManageCredentials: false } }),
}));
vi.mock("@/lib/data-access/data-frames", () => ({ clearAllData: vi.fn() }));
vi.mock("@/lib/perf", () => ({ PerfHud: () => null }));
vi.mock("@/lib/stores", () => ({
  useToastStore: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
vi.mock("@/lib/stores/assistant-store", () => ({
  useAssistantStore: (
    select: (state: { setSetupOpen: () => void }) => unknown,
  ) => select({ setSetupOpen: vi.fn() }),
}));
vi.mock("@/lib/stores/shell-store", () => ({
  useShellStore: (select: (state: { leftNavOpen: boolean }) => unknown) =>
    select({ leftNavOpen: true }),
}));
vi.mock("@/wystack/api", () => ({ api: { listDrafts: {} } }));
vi.mock("@wystack/client", () => ({ useQuery: () => ({ data: [] }) }));
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
  useNavigate: () => vi.fn(),
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
  }) => <button onClick={onClick}>{label ?? children}</button>,
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
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
  DropdownMenuTrigger: ({ render: trigger }: { render: React.ReactNode }) => (
    <>{trigger}</>
  ),
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));
vi.mock("@wystack/ui-react/icons", () => ({
  ChartIcon: () => null,
  CloseIcon: () => null,
  DashboardIcon: () => null,
  DatabaseIcon: () => null,
  DeleteIcon: () => null,
  FileIcon: () => null,
  GithubIcon: () => null,
  GridIcon: () => null,
  MenuIcon: () => null,
  SettingsIcon: () => null,
  SparklesIcon: () => null,
}));

import { Navigation } from "./navigation";

describe("Navigation", () => {
  beforeEach(() => {
    mockLocation.pathname = "/data-sources";
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

    mockLocation.pathname = "/insights";
    rerender(<Navigation />);

    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
  });
});
