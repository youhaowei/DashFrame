import { beforeEach, describe, expect, it } from "vite-plus/test";

import { renderHook } from "@testing-library/react";

import {
  CONTEXT_PANEL_DEFAULT_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  useCollectionView,
  useShellStore,
} from "./shell-store";

describe("useShellStore — shell rails", () => {
  beforeEach(() => {
    useShellStore.persist?.clearStorage?.();
    useShellStore.setState({
      leftNavOpen: true,
      contextAppearanceOpen: false,
      contextPanelWidth: CONTEXT_PANEL_DEFAULT_WIDTH,
      workbenchPanes: {},
      collectionViews: {},
    });
  });

  it("keeps workbench panes per artifact type and per side", () => {
    const { setWorkbenchPaneOpen } = useShellStore.getState();
    setWorkbenchPaneOpen("insight", "right", false);
    setWorkbenchPaneOpen("insight", "left", false);
    setWorkbenchPaneOpen("insight", "left", true);
    expect(useShellStore.getState().workbenchPanes).toEqual({
      insight: { left: true, right: false },
    });
    setWorkbenchPaneOpen("data-source", "left", false);
    expect(useShellStore.getState().workbenchPanes.insight).toEqual({
      left: true,
      right: false,
    });
  });

  it("clamps context panel width to its bounds", () => {
    useShellStore.getState().setContextPanelWidth(10_000);
    expect(useShellStore.getState().contextPanelWidth).toBe(
      CONTEXT_PANEL_MAX_WIDTH,
    );
    useShellStore.getState().setContextPanelWidth(0);
    expect(useShellStore.getState().contextPanelWidth).toBe(
      CONTEXT_PANEL_MIN_WIDTH,
    );
    useShellStore.getState().setContextPanelWidth(360);
    expect(useShellStore.getState().contextPanelWidth).toBe(360);
  });

  it("toggles the appearance section without touching other rails", () => {
    useShellStore.getState().toggleContextAppearance();
    expect(useShellStore.getState().contextAppearanceOpen).toBe(true);
    useShellStore.getState().toggleContextAppearance();
    expect(useShellStore.getState().contextAppearanceOpen).toBe(false);
  });

  it("sets the appearance section explicitly", () => {
    useShellStore.getState().setContextAppearanceOpen(true);
    expect(useShellStore.getState().contextAppearanceOpen).toBe(true);
    useShellStore.getState().setContextAppearanceOpen(false);
    expect(useShellStore.getState().contextAppearanceOpen).toBe(false);
  });

  it("keeps the collection view per artifact type and restores it after a reload", async () => {
    const { setCollectionView } = useShellStore.getState();
    setCollectionView("report", "list");
    setCollectionView("data-source", "grid");
    setCollectionView("report", "list");

    const saved = JSON.parse(localStorage.getItem("dashframe:shell") ?? "{}");
    expect(saved.state.collectionViews).toEqual({
      report: "list",
      "data-source": "grid",
    });

    // A fresh page starts from defaults, then reads the saved choice back.
    useShellStore.setState({ collectionViews: {} });
    localStorage.setItem("dashframe:shell", JSON.stringify(saved));
    await useShellStore.persist.rehydrate();
    expect(useShellStore.getState().collectionViews).toEqual({
      report: "list",
      "data-source": "grid",
    });
  });

  it("reads an unrecognised saved view as grid", () => {
    useShellStore.setState({
      collectionViews: { report: "table" as never, "data-source": "list" },
    });

    expect(renderHook(() => useCollectionView("report")).result.current).toBe(
      "grid",
    );
    expect(
      renderHook(() => useCollectionView("data-source")).result.current,
    ).toBe("list");
    expect(renderHook(() => useCollectionView("draft")).result.current).toBe(
      "grid",
    );
  });
});
