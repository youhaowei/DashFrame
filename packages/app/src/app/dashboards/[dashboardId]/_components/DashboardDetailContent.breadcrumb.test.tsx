import { nativeQueryMock } from "@/test/native-query-fixture";
import { render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const REPORT = {
  id: "report-1",
  name: "Q3 revenue",
  items: [],
  controls: [],
};

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref) => ({
    data: ref._path === "listDashboards" ? [REPORT] : [],
  })),
  useMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
// The report body is not under test; only where the page says it sits.
vi.mock("@/components/dashboards/DashboardGrid", () => ({
  DashboardGrid: () => null,
}));
vi.mock("@/components/dashboards/DashboardControlBar", () => ({
  DashboardControlBar: () => null,
}));
vi.mock("@/components/dashboards/DashboardControlsManager", () => ({
  DashboardControlsManager: () => null,
}));

import {
  AppBreadcrumbs,
  useBreadcrumbStore,
} from "@/components/shell/app-breadcrumbs";
import { TopBarTabsProvider } from "@/components/shell/topbar-tabs";
import { PlatformProvider } from "@/lib/platform";
import DashboardDetailContent from "./DashboardDetailContent";

beforeEach(() => {
  useBreadcrumbStore.setState({ registered: [] });
});

describe("DashboardDetailContent breadcrumb", () => {
  it("names the report in the app bar trail, once", () => {
    render(
      <PlatformProvider>
        <TopBarTabsProvider>
          <AppBreadcrumbs />
          <DashboardDetailContent dashboardId={REPORT.id} />
        </TopBarTabsProvider>
      </PlatformProvider>,
    );

    const breadcrumbs = screen.getAllByRole("navigation", {
      name: "breadcrumb",
    });
    expect(breadcrumbs).toHaveLength(1);
    const trail = within(breadcrumbs[0]!);
    expect(
      trail.getByRole("link", { name: "Reports" }).getAttribute("href"),
    ).toBe("/dashboards");
    trail.getByText("Q3 revenue");
    screen.getByRole("heading", { level: 1, name: "Q3 revenue" });
  });
});
