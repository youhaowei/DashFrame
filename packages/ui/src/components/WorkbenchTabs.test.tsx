import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { WorkbenchTabs, type WorkbenchTabItem } from "./WorkbenchTabs";

// jsdom has no layout, so the strip is exactly as wide as these say it is.
let scrollWidth = 0;
let clientWidth = 0;
let scrolled: Element[] = [];

function setOverflow(content: number, visible: number) {
  scrollWidth = content;
  clientWidth = visible;
}

function tabsFor(names: string[]): WorkbenchTabItem[] {
  return [
    { id: "canvas:data", label: "Data", pinned: "start" },
    ...names.map((name, index) => ({ id: `canvas:viz:${index}`, label: name })),
    { id: "canvas:draft", label: "Chart", pinned: "end", dashed: true },
  ];
}

function strip(
  tabs: WorkbenchTabItem[],
  activeId: string,
  onSelect = () => {},
) {
  return (
    <WorkbenchTabs
      label="Canvas views"
      tabs={tabs}
      activeId={activeId}
      onSelect={onSelect}
      findLabel="Find a chart"
    />
  );
}

const finder = () => screen.queryByRole("button", { name: "Find a chart" });

beforeEach(() => {
  setOverflow(0, 0);
  scrolled = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});

describe("WorkbenchTabs overflow", () => {
  it("reveals the finder when tabs are added, without the pane resizing", () => {
    // The pane never changes size here; only the tab set grows, which is what
    // happens when the saved chart list arrives from the server after mount.
    setOverflow(200, 400);
    const { rerender } = render(strip(tabsFor(["One"]), "canvas:data"));
    expect(finder()).toBeNull();

    setOverflow(1200, 400);
    rerender(
      strip(
        tabsFor(["One", "Two", "Three", "Four", "Five", "Six"]),
        "canvas:data",
      ),
    );
    expect(finder()).not.toBeNull();
  });

  it("hides the finder again once the tabs fit", () => {
    setOverflow(1200, 400);
    const { rerender } = render(
      strip(tabsFor(["One", "Two", "Three"]), "canvas:data"),
    );
    expect(finder()).not.toBeNull();

    setOverflow(200, 400);
    rerender(strip(tabsFor(["One"]), "canvas:data"));
    expect(finder()).toBeNull();
  });
});

describe("WorkbenchTabs active tab", () => {
  it("scrolls a tab into view when it is activated from elsewhere", () => {
    // Saving a chart, restoring a persisted view, and picking a chart in the
    // visualization pane all change the active tab without touching the strip.
    const tabs = tabsFor(["One", "Two", "Three"]);
    const { rerender } = render(strip(tabs, "canvas:data"));
    scrolled = [];

    rerender(strip(tabs, "canvas:viz:2"));

    expect(scrolled).toContain(screen.getByRole("tab", { name: /Three/ }));
  });
});

describe("WorkbenchTabs keyboard", () => {
  it("moves focus with the arrow keys without selecting", () => {
    const onSelect = vi.fn();
    render(strip(tabsFor(["One", "Two"]), "canvas:data", onSelect));

    const dataTab = screen.getByRole("tab", { name: /Data/ });
    dataTab.focus();
    fireEvent.keyDown(dataTab, { key: "ArrowRight" });

    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: /One/ }),
    );
    // Opening a chart loads its data, so arrowing past one must not open it.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the tablist owning nothing but tabs", () => {
    // Overflowing on purpose: it renders the finder, and Base UI only makes
    // the viewport focusable once there is something to scroll. Both would
    // otherwise sit inside the tablist, which may own only tabs.
    setOverflow(1200, 400);
    const { container } = render(
      strip(tabsFor(["One", "Two", "Three"]), "canvas:data"),
    );
    expect(finder()).not.toBeNull();

    const list = container.querySelector('[role="tablist"]');
    expect(list?.contains(finder())).toBe(false);
    const focusable = [
      ...(list?.querySelectorAll<HTMLElement>("[tabindex]") ?? []),
    ].filter((element) => element.tabIndex === 0);
    expect(focusable.every((element) => element.role === "tab")).toBe(true);
  });

  it("keeps the strip to a single tab stop", () => {
    render(strip(tabsFor(["One", "Two"]), "canvas:data"));

    const stops = screen
      .getAllByRole("tab")
      .filter((tab) => tab.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.dataset.tabId).toBe("canvas:data");
  });
});
