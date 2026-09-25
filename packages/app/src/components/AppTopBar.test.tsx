import { render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockPlatform } = vi.hoisted(() => ({
  mockPlatform: { hasInsetTrafficLights: false },
}));

vi.mock("@/lib/platform", () => ({ usePlatform: () => mockPlatform }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
// The strip's own behaviour is covered by WorkbenchTabs' tests; here only its
// place in the bar matters.
vi.mock("@dashframe/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dashframe/ui")>()),
  WorkbenchTabs: ({ label }: { label: string }) => (
    <div role="tablist" aria-label={label} />
  ),
}));

import {
  useAppBreadcrumbs,
  useBreadcrumbStore,
  type AppBreadcrumb,
} from "@/components/shell/app-breadcrumbs";
import {
  TopBarTabsProvider,
  useTopBarTabs,
  type TopBarTabs,
} from "@/components/shell/topbar-tabs";
import { useShellStore } from "@/lib/stores/shell-store";
import { AppTopBar } from "./AppTopBar";

const TABLE_TABS: TopBarTabs = {
  label: "Tables",
  tabs: [{ id: "orders", label: "Orders" }],
  activeId: "orders",
  onSelect: () => {},
};

function Page({
  trail,
  tabs = null,
}: {
  trail: AppBreadcrumb[] | null;
  tabs?: TopBarTabs | null;
}) {
  useAppBreadcrumbs(trail);
  useTopBarTabs(tabs);
  return null;
}

function renderBar(page?: React.ReactNode) {
  return render(
    <TopBarTabsProvider>
      <AppTopBar />
      {page}
    </TopBarTabsProvider>,
  );
}

const spacer = () => screen.queryByTestId("traffic-light-spacer");

beforeEach(() => {
  mockPlatform.hasInsetTrafficLights = false;
  useBreadcrumbStore.setState({ registered: [] });
  useShellStore.setState({ leftNavOpen: true });
});

describe("AppTopBar traffic-light room", () => {
  it("reserves none on the web", () => {
    renderBar();
    expect(spacer()).toBeNull();
  });

  // jsdom evaluates no media queries, so the breakpoint shows up as the class
  // that collapses the room at desktop widths.
  it("gives the room to the nav on macOS desktop while the nav is open", () => {
    mockPlatform.hasInsetTrafficLights = true;
    renderBar();
    expect(spacer()?.className).toContain("min-[1024px]:w-0");
    expect(spacer()?.className).toContain("motion-reduce:transition-none");
  });

  it("keeps the room in the bar on macOS desktop while the nav is closed", () => {
    mockPlatform.hasInsetTrafficLights = true;
    useShellStore.setState({ leftNavOpen: false });
    renderBar();
    expect(spacer()?.className).toContain("w-16");
    expect(spacer()?.className).not.toContain("min-[1024px]:w-0");
  });
});

describe("AppTopBar breadcrumb", () => {
  it("shows the page's trail with the last item as the current page", () => {
    renderBar(
      <Page
        trail={[{ label: "Reports", to: "/dashboards" }, { label: "Q3" }]}
      />,
    );
    const trail = within(
      screen.getByRole("navigation", { name: "breadcrumb" }),
    );
    trail.getByRole("link", { name: "Reports" });
    expect(trail.getByText("Q3").getAttribute("aria-current")).toBe("page");
  });

  it("puts the breadcrumb before the tabs, which stand in for the current page", () => {
    renderBar(
      <Page
        trail={[
          { label: "Data Sources", to: "/data-sources" },
          { label: "Warehouse" },
        ]}
        tabs={TABLE_TABS}
      />,
    );
    const breadcrumb = screen.getByRole("navigation", { name: "breadcrumb" });
    const strip = screen.getByRole("tablist", { name: "Tables" });
    expect(
      breadcrumb.compareDocumentPosition(strip) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(breadcrumb).getByText("Warehouse").getAttribute("aria-current"),
    ).toBeNull();
  });

  it("shows no breadcrumb when the page registers none", () => {
    renderBar(<Page trail={null} />);
    expect(screen.queryByRole("navigation", { name: "breadcrumb" })).toBeNull();
  });
});

describe("AppTopBar controls", () => {
  // Appearance lives on the Settings page; the bar keeps no toggle for it.
  it("offers only the sidebar and search controls", () => {
    renderBar();
    expect(
      screen
        .getAllByRole("button")
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        ),
    ).toEqual(["Hide sidebar", "Search"]);
    expect(screen.queryByRole("button", { name: /appearance/i })).toBeNull();
  });
});
