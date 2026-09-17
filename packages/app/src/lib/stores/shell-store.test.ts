import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  CONTEXT_PANEL_DEFAULT_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  useShellStore,
} from "./shell-store";

describe("useShellStore — shell rails", () => {
  beforeEach(() => {
    useShellStore.persist?.clearStorage?.();
    useShellStore.setState({
      leftNavOpen: true,
      contextAppearanceOpen: false,
      contextPanelWidth: CONTEXT_PANEL_DEFAULT_WIDTH,
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
});
