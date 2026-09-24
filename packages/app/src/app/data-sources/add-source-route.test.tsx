import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { Route as DataSourcesIndexRoute } from "@/routes/data-sources/index";

// The router restores scroll on navigation; jsdom does not implement it.
window.scrollTo = () => {};

vi.mock("@/app/data-sources/page", () => ({
  default: ({
    addSourceOpen,
    onAddSourceOpenChange,
  }: {
    addSourceOpen: boolean;
    onAddSourceOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onAddSourceOpenChange(true)}>
        Add Source
      </button>
      {addSourceOpen ? (
        <div role="dialog" aria-label="Add Data Source">
          <button type="button" onClick={() => onAddSourceOpenChange(false)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  ),
}));

/** The data sources index route under a bare root, beside one other page. */
function renderAt(path: string) {
  const root = createRootRoute({ component: Outlet });
  const reports = createRoute({
    getParentRoute: () => root,
    path: "/dashboards",
    component: () => <h1>Reports</h1>,
  });
  const dataSources = DataSourcesIndexRoute.update({
    id: "/data-sources/",
    path: "/data-sources/",
    getParentRoute: () => root,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([reports, dataSources as never]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const location = (router: ReturnType<typeof renderAt>) =>
  router.state.location.pathname + router.state.location.searchStr;

describe("the data sources route's addSource param", () => {
  it("opens the Add dialog, and closing it drops the param in place", async () => {
    const router = renderAt("/dashboards");
    await act(() =>
      router.navigate({
        to: "/data-sources",
        search: { addSource: true },
      } as never),
    );
    expect(
      await screen.findByRole("dialog", { name: "Add Data Source" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(location(router)).toBe("/data-sources"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Closing replaced the entry, so one Back leaves the page.
    await act(async () => router.history.back());
    await vi.waitFor(() => expect(location(router)).toBe("/dashboards"));
  });

  it("opened on the page itself, adds no history entry", async () => {
    const router = renderAt("/dashboards");
    await act(() => router.navigate({ to: "/data-sources" } as never));
    // What the command palette does when it is already on this page.
    await act(() =>
      router.navigate({
        to: "/data-sources",
        search: { addSource: true },
        replace: true,
      } as never),
    );
    await screen.findByRole("dialog", { name: "Add Data Source" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(location(router)).toBe("/data-sources"));
    await act(async () => router.history.back());
    await vi.waitFor(() => expect(location(router)).toBe("/dashboards"));
  });

  it("ignores any value but true", async () => {
    renderAt("/data-sources?addSource=yes");
    await screen.findByRole("button", { name: "Add Source" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
