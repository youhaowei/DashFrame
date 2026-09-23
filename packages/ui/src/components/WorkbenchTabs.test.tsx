import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  WorkbenchTabs,
  orderWorkbenchTabs,
  type WorkbenchTabItem,
} from "./WorkbenchTabs";

// jsdom has no layout, so the strip is exactly as wide as these say it is.
let scrollWidth = 0;
let clientWidth = 0;
let scrolled: { target: Element; options?: ScrollIntoViewOptions }[] = [];

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

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  setOverflow(0, 0);
  scrolled = [];
  stubReducedMotion(false);
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
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 70,
  });
  Element.prototype.scrollIntoView = vi.fn(function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ) {
    scrolled.push({
      target: this,
      options: typeof options === "object" ? options : undefined,
    });
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

  it("does not let the finder keep itself visible", () => {
    const tabs = tabsFor(["One", "Two", "Three"]);
    setOverflow(410, 400);
    const { rerender } = render(strip(tabs, "canvas:data"));
    expect(finder()).not.toBeNull();

    // Showing the 70px finder shrinks the viewport, but the 410px tab strip
    // would fit again if that finder disappeared (340 + 70 + the 4px gap).
    setOverflow(410, 340);
    rerender(strip([...tabs], "canvas:data"));
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

    const reveal = scrolled.find(
      (entry) => entry.target === screen.getByRole("tab", { name: /Three/ }),
    );
    expect(reveal).toBeDefined();
    expect(reveal?.options?.behavior).toBe("smooth");
  });

  it("does not animate the reveal when the viewer asks for less motion", () => {
    // Scripted scrolling is animation: DESIGN.md's reduced-motion rule covers
    // it, not only the CSS transitions on the tabs.
    stubReducedMotion(true);
    const tabs = tabsFor(["One", "Two", "Three"]);
    const { rerender } = render(strip(tabs, "canvas:data"));
    scrolled = [];

    rerender(strip(tabs, "canvas:viz:2"));

    const reveal = scrolled.find(
      (entry) => entry.target === screen.getByRole("tab", { name: /Three/ }),
    );
    expect(reveal?.options?.behavior).toBe("auto");
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

  it("leaves modified arrow shortcuts to the browser", () => {
    render(strip(tabsFor(["One", "Two"]), "canvas:data"));

    const dataTab = screen.getByRole("tab", { name: /Data/ });
    dataTab.focus();
    const allowed = fireEvent.keyDown(dataTab, {
      key: "ArrowLeft",
      altKey: true,
    });

    expect(allowed).toBe(true);
    expect(document.activeElement).toBe(dataTab);
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

  it("moves the tab stop to whichever tab was focused last", () => {
    // Activation is manual, so focus and selection diverge while arrowing.
    // The stop has to follow focus, or tabbing back into the strip returns to
    // the selected tab instead of where the user left off.
    render(strip(tabsFor(["One", "Two"]), "canvas:data"));

    const dataTab = screen.getByRole("tab", { name: /Data/ });
    dataTab.focus();
    fireEvent.keyDown(dataTab, { key: "ArrowRight" });

    const stops = screen
      .getAllByRole("tab")
      .filter((tab) => tab.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.dataset.tabId).toBe("canvas:viz:0");
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

describe("WorkbenchTabs finder", () => {
  it("names an unsaved result without relying on its status color", () => {
    setOverflow(1200, 400);
    render(
      strip(
        [
          { id: "canvas:data", label: "Data", pinned: "start" },
          {
            id: "canvas:draft",
            label: "Untitled chart",
            pinned: "end",
            unsaved: true,
          },
        ],
        "canvas:data",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Find a chart" }));
    expect(
      screen.getByRole("option", { name: "Untitled chart Not saved" }),
    ).toBeDefined();
  });
});

describe("orderWorkbenchTabs", () => {
  it("matches the strip's visual order whatever order tabs arrive in", () => {
    const tabs: WorkbenchTabItem[] = [
      { id: "draft", label: "Chart", pinned: "end" },
      { id: "one", label: "One" },
      { id: "data", label: "Data", pinned: "start" },
      { id: "two", label: "Two" },
    ];
    render(strip(tabs, "data"));
    const shown = screen
      .getAllByRole("tab")
      .map((tab) => tab.getAttribute("data-tab-id"));
    expect(orderWorkbenchTabs(tabs).map((tab) => tab.id)).toEqual(shown);
    expect(shown).toEqual(["data", "one", "two", "draft"]);
  });
});
