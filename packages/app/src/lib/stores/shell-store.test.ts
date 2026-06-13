import { beforeEach, describe, expect, it } from "vitest";

import { useAssistantStore } from "./assistant-store";
import {
  RIGHT_DOCK_DEFAULT_WIDTH,
  RIGHT_DOCK_MAX_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  useShellStore,
} from "./shell-store";

describe("useShellStore — right dock", () => {
  beforeEach(() => {
    useShellStore.persist?.clearStorage?.();
    useShellStore.setState({
      leftNavOpen: true,
      rightPanelOpen: false,
      rightDockWidth: RIGHT_DOCK_DEFAULT_WIDTH,
    });
    useAssistantStore.setState({ isOpen: false });
  });

  it("clamps right-dock width to its bounds", () => {
    useShellStore.getState().setRightDockWidth(10_000);
    expect(useShellStore.getState().rightDockWidth).toBe(RIGHT_DOCK_MAX_WIDTH);
    useShellStore.getState().setRightDockWidth(0);
    expect(useShellStore.getState().rightDockWidth).toBe(RIGHT_DOCK_MIN_WIDTH);
    useShellStore.getState().setRightDockWidth(420);
    expect(useShellStore.getState().rightDockWidth).toBe(420);
  });

  // The load-bearing invariant: the appearance panel and the assistant share one
  // right slot, so opening appearance must evict an open assistant.
  it("evicts the assistant when the appearance panel opens", () => {
    useAssistantStore.getState().open();
    expect(useAssistantStore.getState().isOpen).toBe(true);

    useShellStore.getState().setRightPanelOpen(true);

    expect(useShellStore.getState().rightPanelOpen).toBe(true);
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("evicts the assistant when toggling the appearance panel on", () => {
    useAssistantStore.getState().open();
    useShellStore.getState().toggleRightPanel();
    expect(useShellStore.getState().rightPanelOpen).toBe(true);
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("leaves the assistant alone when closing the appearance panel", () => {
    useShellStore.setState({ rightPanelOpen: true });
    useAssistantStore.setState({ isOpen: false });
    useShellStore.getState().setRightPanelOpen(false);
    // Closing appearance does not summon the assistant.
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });
});
