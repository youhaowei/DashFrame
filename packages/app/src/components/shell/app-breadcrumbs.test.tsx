import { render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import {
  type AppBreadcrumb,
  AppBreadcrumbs,
  useAppBreadcrumbs,
  useBreadcrumbStore,
} from "./app-breadcrumbs";

function Registers({ items }: { items: AppBreadcrumb[] | null }) {
  useAppBreadcrumbs(items);
  return null;
}

const trail = () =>
  within(screen.getByRole("navigation", { name: "breadcrumb" }));

const SOURCE: AppBreadcrumb[] = [
  { label: "Data Sources", to: "/data-sources" },
  { label: "Warehouse" },
];

beforeEach(() => {
  useBreadcrumbStore.setState({ registered: [] });
});

describe("useAppBreadcrumbs", () => {
  it("shows the trail while the page is mounted and clears it on unmount", () => {
    const { rerender } = render(
      <>
        <AppBreadcrumbs />
        <Registers items={SOURCE} />
      </>,
    );

    expect(
      trail().getByRole("link", { name: "Data Sources" }).getAttribute("href"),
    ).toBe("/data-sources");
    expect(trail().getByText("Warehouse").getAttribute("aria-current")).toBe(
      "page",
    );

    rerender(<AppBreadcrumbs />);
    expect(screen.queryByRole("navigation", { name: "breadcrumb" })).toBeNull();
  });

  it("shows nothing while the page passes null", () => {
    render(
      <>
        <AppBreadcrumbs />
        <Registers items={null} />
      </>,
    );
    expect(screen.queryByRole("navigation", { name: "breadcrumb" })).toBeNull();
  });

  it("follows the page's trail as it changes", () => {
    const { rerender } = render(
      <>
        <AppBreadcrumbs />
        <Registers items={SOURCE} />
      </>,
    );
    rerender(
      <>
        <AppBreadcrumbs />
        <Registers items={[SOURCE[0]!, { label: "Renamed" }]} />
      </>,
    );
    trail().getByText("Renamed");
    expect(trail().queryByText("Warehouse")).toBeNull();
  });

  it("keeps the incoming page's trail when the outgoing page resolves late", () => {
    const { rerender } = render(
      <>
        <AppBreadcrumbs />
        <Registers key="old" items={null} />
        <Registers key="new" items={[{ label: "Drafts" }]} />
      </>,
    );
    // The outgoing page learns its trail after the new page claimed the bar.
    rerender(
      <>
        <AppBreadcrumbs />
        <Registers key="old" items={SOURCE} />
        <Registers key="new" items={[{ label: "Drafts" }]} />
      </>,
    );
    trail().getByText("Drafts");
    expect(trail().queryByText("Warehouse")).toBeNull();
  });

  it("hands the bar back to the page still on screen when a newer one unmounts", () => {
    const { rerender } = render(
      <>
        <AppBreadcrumbs />
        <Registers key="current" items={SOURCE} />
        <Registers key="aborted" items={[{ label: "Drafts" }]} />
      </>,
    );
    trail().getByText("Drafts");

    rerender(
      <>
        <AppBreadcrumbs />
        <Registers key="current" items={SOURCE} />
      </>,
    );
    trail().getByText("Warehouse");
  });
});

describe("AppBreadcrumbs before tabs", () => {
  it("lets the tabs stand in for the current page", () => {
    const { container } = render(
      <>
        <AppBreadcrumbs beforeTabs />
        <Registers items={SOURCE} />
      </>,
    );

    const source = trail().getByText("Warehouse");
    expect(source.getAttribute("aria-current")).toBeNull();
    // A separator follows the last item, leading into the tab strip.
    const separators = container.querySelectorAll('li[role="presentation"]');
    expect(separators).toHaveLength(2);
    expect(container.querySelector("ol")?.lastElementChild).toBe(separators[1]);
  });
});
