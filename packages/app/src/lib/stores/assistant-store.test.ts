import { beforeEach, describe, expect, it } from "vitest";

import { useAssistantStore } from "./assistant-store";

const STORAGE_KEY = "dashframe:assistant";

describe("useAssistantStore", () => {
  beforeEach(() => {
    // Reset to defaults between tests (the store is a module singleton) and
    // drop any persisted payload from a prior test.
    useAssistantStore.persist.clearStorage();
    useAssistantStore.setState({ isOpen: false });
  });

  it("toggles open state", () => {
    expect(useAssistantStore.getState().isOpen).toBe(false);
    useAssistantStore.getState().toggle();
    expect(useAssistantStore.getState().isOpen).toBe(true);
    useAssistantStore.getState().toggle();
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("persists open state to localStorage", () => {
    useAssistantStore.getState().open();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain('"isOpen":true');
    // Action closures are not serialized.
    expect(raw).not.toContain("toggle");
  });

  it("re-hydrates open state from a prior session", async () => {
    // Seed storage directly (no intervening setState, which would re-persist)
    // to faithfully simulate a fresh page load.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { isOpen: true }, version: 0 }),
    );

    await useAssistantStore.persist.rehydrate();

    expect(useAssistantStore.getState().isOpen).toBe(true);
  });
});
