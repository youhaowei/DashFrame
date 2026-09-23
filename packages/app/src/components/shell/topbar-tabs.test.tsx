import { PlatformProvider } from "@/lib/platform";
import type { WorkbenchTabItem } from "@dashframe/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  TopBarTabsProvider,
  resolveTopBarTabShortcut,
  useRegisteredTopBarTabs,
  useTopBarTabs,
  type TopBarTabs,
} from "./topbar-tabs";

const items: WorkbenchTabItem[] = [
  { id: "new", label: "Chart", pinned: "end", dashed: true },
  { id: "data", label: "Data", pinned: "start" },
  { id: "a", label: "Revenue", closable: true },
  { id: "b", label: "Orders" },
];

function tabsOf(overrides: Partial<TopBarTabs> = {}): TopBarTabs {
  return {
    label: "Canvas views",
    tabs: items,
    activeId: "data",
    onSelect: () => {},
    ...overrides,
  };
}

function Binder({ tabs }: { tabs: TopBarTabs | null }) {
  useTopBarTabs(tabs);
  return null;
}

function Slot() {
  const tabs = useRegisteredTopBarTabs();
  return (
    <output data-testid="slot">
      {tabs ? `${tabs.label}:${tabs.activeId}` : "empty"}
    </output>
  );
}

function renderShell(children: React.ReactNode) {
  return render(
    <PlatformProvider>
      <TopBarTabsProvider>
        <Slot />
        {children}
      </TopBarTabsProvider>
    </PlatformProvider>,
  );
}

const slot = () => screen.getByTestId("slot").textContent;

describe("useTopBarTabs", () => {
  it("shows a page's tabs while it is mounted and clears them after", () => {
    const { rerender } = renderShell(<Binder tabs={tabsOf()} />);
    expect(slot()).toBe("Canvas views:data");

    rerender(
      <PlatformProvider>
        <TopBarTabsProvider>
          <Slot />
        </TopBarTabsProvider>
      </PlatformProvider>,
    );
    expect(slot()).toBe("empty");
  });

  it("follows the page's active tab", () => {
    const { rerender } = renderShell(<Binder tabs={tabsOf()} />);
    rerender(
      <PlatformProvider>
        <TopBarTabsProvider>
          <Slot />
          <Binder tabs={tabsOf({ activeId: "b" })} />
        </TopBarTabsProvider>
      </PlatformProvider>,
    );
    expect(slot()).toBe("Canvas views:b");
  });

  it("clears the slot when the page passes null", () => {
    const { rerender } = renderShell(<Binder tabs={tabsOf()} />);
    rerender(
      <PlatformProvider>
        <TopBarTabsProvider>
          <Slot />
          <Binder tabs={null} />
        </TopBarTabsProvider>
      </PlatformProvider>,
    );
    expect(slot()).toBe("empty");
  });

  it("does not let the page being left clear the page being entered", () => {
    const shell = (children: React.ReactNode) => (
      <PlatformProvider>
        <TopBarTabsProvider>
          <Slot />
          {children}
        </TopBarTabsProvider>
      </PlatformProvider>
    );
    const { rerender } = render(
      shell(<Binder key="old" tabs={tabsOf({ label: "Old" })} />),
    );
    // The next route mounts before the previous one unmounts.
    rerender(
      shell(
        <>
          <Binder key="old" tabs={tabsOf({ label: "Old" })} />
          <Binder key="new" tabs={tabsOf({ label: "New" })} />
        </>,
      ),
    );
    expect(slot()).toBe("New:data");

    // A late update from the old page does not take the slot back…
    rerender(
      shell(
        <>
          <Binder key="old" tabs={tabsOf({ label: "Old", activeId: "a" })} />
          <Binder key="new" tabs={tabsOf({ label: "New" })} />
        </>,
      ),
    );
    expect(slot()).toBe("New:data");

    // …and its unmount leaves the new page's tabs in place.
    rerender(shell(<Binder key="new" tabs={tabsOf({ label: "New" })} />));
    expect(slot()).toBe("New:data");
  });
});

describe("tab shortcuts", () => {
  const key = (
    k: string,
    mods: Partial<
      Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>
    > = {},
  ) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("⌘W closes the active tab only when it is closable and handled", () => {
    const onClose = () => {};
    expect(
      resolveTopBarTabShortcut(
        key("w", { metaKey: true }),
        tabsOf({ activeId: "a", onClose }),
        true,
      ),
    ).toEqual({ action: "close", id: "a" });
    // Not closable: the window's own ⌘W keeps working.
    expect(
      resolveTopBarTabShortcut(
        key("w", { metaKey: true }),
        tabsOf({ activeId: "b", onClose }),
        true,
      ),
    ).toBeNull();
    // Closable, but the page cannot close it.
    expect(
      resolveTopBarTabShortcut(
        key("w", { metaKey: true }),
        tabsOf({ activeId: "a" }),
        true,
      ),
    ).toBeNull();
  });

  it("uses Ctrl+W off macOS and ignores ⌘W there", () => {
    const tabs = tabsOf({ activeId: "a", onClose: () => {} });
    expect(
      resolveTopBarTabShortcut(key("w", { ctrlKey: true }), tabs, false),
    ).toEqual({ action: "close", id: "a" });
    expect(
      resolveTopBarTabShortcut(key("w", { metaKey: true }), tabs, false),
    ).toBeNull();
    expect(
      resolveTopBarTabShortcut(key("w", { ctrlKey: true }), tabs, true),
    ).toBeNull();
  });

  it("Ctrl+Tab cycles in strip order, wrapping, and skips the dashed tab", () => {
    const next = (activeId: string, shiftKey = false) =>
      resolveTopBarTabShortcut(
        key("Tab", { ctrlKey: true, shiftKey }),
        tabsOf({ activeId }),
        true,
      );
    // Strip order is Data, Revenue, Orders, then the pinned-end "Chart".
    expect(next("data")).toEqual({ action: "select", id: "a" });
    expect(next("a")).toEqual({ action: "select", id: "b" });
    expect(next("b")).toEqual({ action: "select", id: "data" });
    expect(next("data", true)).toEqual({ action: "select", id: "b" });
    expect(next("a", true)).toEqual({ action: "select", id: "data" });
  });

  it("cycles out of a dashed tab that is active", () => {
    expect(
      resolveTopBarTabShortcut(
        key("Tab", { ctrlKey: true }),
        tabsOf({ activeId: "new" }),
        true,
      ),
    ).toEqual({ action: "select", id: "data" });
  });

  it("leaves plain Tab and unrelated keys alone", () => {
    expect(resolveTopBarTabShortcut(key("Tab"), tabsOf(), true)).toBeNull();
    expect(
      resolveTopBarTabShortcut(key("w", { ctrlKey: true }), tabsOf(), true),
    ).toBeNull();
    expect(
      resolveTopBarTabShortcut(
        key("Tab", { ctrlKey: true, altKey: true }),
        tabsOf(),
        true,
      ),
    ).toBeNull();
  });

  it("selects through the page's handler when Ctrl+Tab is pressed", () => {
    const onSelect = vi.fn();
    renderShell(<Binder tabs={tabsOf({ onSelect })} />);
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not claim ⌘W or Ctrl+W when the active tab cannot close", () => {
    const onClose = vi.fn();
    renderShell(<Binder tabs={tabsOf({ activeId: "b", onClose })} />);
    for (const mods of [{ metaKey: true }, { ctrlKey: true }]) {
      fireEvent.keyDown(window, { key: "w", ...mods });
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening once the page's tabs are gone", () => {
    const onSelect = vi.fn();
    const { unmount } = renderShell(<Binder tabs={tabsOf({ onSelect })} />);
    unmount();
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
