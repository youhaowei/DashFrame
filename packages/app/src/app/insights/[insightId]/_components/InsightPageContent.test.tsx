import { nativeQueryMock } from "@/test/native-query-fixture";
import { render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockInsightQuery } = vi.hoisted(() => ({
  mockInsightQuery: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() => mockInsightQuery()),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
// The workbench itself is covered by InsightView's tests.
vi.mock("./InsightView", () => ({ InsightView: () => null }));

import {
  AppBreadcrumbs,
  useBreadcrumbStore,
} from "@/components/shell/app-breadcrumbs";
import InsightPageContent from "./InsightPageContent";

function Page() {
  return (
    <>
      <AppBreadcrumbs />
      <InsightPageContent insightId="insight-1" />
    </>
  );
}

beforeEach(() => {
  useBreadcrumbStore.setState({ registered: [] });
});

describe("InsightPageContent breadcrumb", () => {
  it("names the question in the app bar once it loads", () => {
    mockInsightQuery.mockReturnValue({ isLoading: true });
    const { rerender } = render(<Page />);
    expect(screen.queryByRole("navigation", { name: "breadcrumb" })).toBeNull();

    mockInsightQuery.mockReturnValue({
      data: { id: "insight-1", name: "Revenue by region" },
    });
    rerender(<Page />);

    const trail = within(
      screen.getByRole("navigation", { name: "breadcrumb" }),
    );
    expect(
      trail.getByRole("link", { name: "Questions" }).getAttribute("href"),
    ).toBe("/insights");
    trail.getByText("Revenue by region");
  });
});
