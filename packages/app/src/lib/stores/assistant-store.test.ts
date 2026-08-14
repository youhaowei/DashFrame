import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useAssistantStore } from "./assistant-store";

const STORAGE_KEY = "dashframe:assistant";

describe("useAssistantStore", () => {
  beforeEach(() => {
    // Reset to defaults between tests (the store is a module singleton) and
    // drop any persisted payload from a prior test.
    useAssistantStore.persist.clearStorage();
    useAssistantStore.setState({
      isOpen: false,
      isSetupOpen: false,
      pendingDraftId: null,
      runStatus: "idle",
      activeDraftId: null,
      turns: [],
      streamingText: "",
      error: null,
    });
  });

  it("toggles open state", () => {
    expect(useAssistantStore.getState().isOpen).toBe(false);
    useAssistantStore.getState().toggle();
    expect(useAssistantStore.getState().isOpen).toBe(true);
    useAssistantStore.getState().toggle();
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("tracks provider setup separately from the assistant rail", () => {
    useAssistantStore.getState().setSetupOpen(true);

    expect(useAssistantStore.getState().isSetupOpen).toBe(true);
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

  it("keeps eager-open draft ids hidden until first mutation", () => {
    useAssistantStore.getState().beginRun("Make a dashboard");
    useAssistantStore.getState().receiveRunEvent({ type: "run-start" });
    useAssistantStore.getState().receiveRunEvent({
      type: "run-end",
      draftId: "draft-empty",
      firstMutationObserved: false,
      terminationReason: "completed",
    });

    expect(useAssistantStore.getState().activeDraftId).toBe("draft-empty");
    expect(useAssistantStore.getState().pendingDraftId).toBeNull();
    expect(useAssistantStore.getState().runStatus).toBe("completed");
  });

  it("surfaces the review draft only after first successful mutation", () => {
    useAssistantStore.getState().beginRun("Rename it");
    useAssistantStore.getState().receiveRunEvent({
      type: "command-start",
      toolCallId: "tool-1",
      commandType: "RenameNode",
      args: { id: "node-1", name: "Revenue" },
    });

    expect(useAssistantStore.getState().pendingDraftId).toBeNull();

    useAssistantStore.getState().receiveRunEvent({
      type: "first-mutation",
      draftId: "draft-mutated",
    });
    useAssistantStore.getState().receiveRunEvent({
      type: "command-end",
      toolCallId: "tool-1",
      commandType: "RenameNode",
      isError: false,
      result: { commandType: "RenameNode" },
    });

    expect(useAssistantStore.getState().pendingDraftId).toBe("draft-mutated");
    expect(useAssistantStore.getState().turns.at(-1)?.status).toBe("success");
  });

  it("clears a prior run's pending draft when a new run begins", () => {
    useAssistantStore.getState().setPendingDraft("draft-old-run");

    useAssistantStore.getState().beginRun("Follow-up prompt");

    expect(useAssistantStore.getState().pendingDraftId).toBeNull();
  });

  it("reports an aborted run as aborted, not as an error", () => {
    useAssistantStore.getState().beginRun("Make a dashboard");
    useAssistantStore.getState().receiveRunEvent({
      type: "run-end",
      draftId: "draft-aborted",
      firstMutationObserved: false,
      terminationReason: "aborted",
    });

    expect(useAssistantStore.getState().runStatus).toBe("aborted");
    expect(useAssistantStore.getState().error).toBeNull();
  });

  it("does not expose streamed runtime errors in the timeline", () => {
    useAssistantStore.getState().beginRun("Make a dashboard");
    useAssistantStore.getState().receiveRunEvent({
      type: "error",
      message: "provider secret and stack trace",
    });

    const state = useAssistantStore.getState();
    expect(state.error).toBe(
      "The assistant couldn't complete this request. Try again.",
    );
    expect(state.turns.at(-1)?.text).toBe(state.error);
    expect(JSON.stringify(state.turns)).not.toContain("provider secret");
  });

  it("clears the surfaced draft after publish or discard", () => {
    useAssistantStore.getState().setPendingDraft("draft-review");
    expect(useAssistantStore.getState().isOpen).toBe(true);

    useAssistantStore.getState().setPendingDraft(null);

    expect(useAssistantStore.getState().pendingDraftId).toBeNull();
    expect(useAssistantStore.getState().isOpen).toBe(true);
  });
});
