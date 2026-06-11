import { beforeEach, describe, expect, it } from "vitest";

import {
  ASSISTANT_DEFAULT_WIDTH,
  ASSISTANT_MAX_WIDTH,
  ASSISTANT_MIN_WIDTH,
  useAssistantStore,
} from "./assistant-store";

const STORAGE_KEY = "dashframe:assistant";

describe("useAssistantStore", () => {
  beforeEach(() => {
    // Reset to defaults between tests (the store is a module singleton) and
    // drop any persisted payload from a prior test.
    useAssistantStore.persist.clearStorage();
    useAssistantStore.setState({
      isOpen: false,
      dock: "docked",
      width: ASSISTANT_DEFAULT_WIDTH,
    });
  });

  it("toggles open state", () => {
    expect(useAssistantStore.getState().isOpen).toBe(false);
    useAssistantStore.getState().toggle();
    expect(useAssistantStore.getState().isOpen).toBe(true);
    useAssistantStore.getState().toggle();
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("toggles dock preference between docked and floating", () => {
    expect(useAssistantStore.getState().dock).toBe("docked");
    useAssistantStore.getState().toggleDock();
    expect(useAssistantStore.getState().dock).toBe("floating");
    useAssistantStore.getState().toggleDock();
    expect(useAssistantStore.getState().dock).toBe("docked");
  });

  it("clamps width to the rail bounds", () => {
    useAssistantStore.getState().setWidth(10_000);
    expect(useAssistantStore.getState().width).toBe(ASSISTANT_MAX_WIDTH);
    useAssistantStore.getState().setWidth(0);
    expect(useAssistantStore.getState().width).toBe(ASSISTANT_MIN_WIDTH);
    useAssistantStore.getState().setWidth(420);
    expect(useAssistantStore.getState().width).toBe(420);
  });

  it("persists dock + width + open preference to localStorage", () => {
    useAssistantStore.getState().open();
    useAssistantStore.getState().setDock("floating");
    useAssistantStore.getState().setWidth(450);

    // Assert against the raw localStorage payload the persist middleware wrote,
    // proving the durable preferences round-trip to disk — not just in-memory
    // state. (The superjson storage adapter wraps shapes, so we match on the
    // serialized content rather than a deep object shape.)
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain("floating");
    expect(raw).toContain("450");
    expect(raw).toContain('"isOpen":true');
  });

  it("persists only the durable preference fields (partialize)", () => {
    useAssistantStore.getState().open();
    useAssistantStore.getState().setDock("floating");

    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    // Durable fields are written…
    expect(raw).toContain("dock");
    expect(raw).toContain("width");
    expect(raw).toContain("isOpen");
    // …and the action closures are not serialized.
    expect(raw).not.toContain("toggleDock");
    expect(raw).not.toContain("setWidth");
  });
});
