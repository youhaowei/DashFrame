import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AssistantRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "aborted"
  | "error";

export interface AssistantTurn {
  id: string;
  kind: "user" | "assistant" | "command" | "tool" | "status";
  text: string;
  status?: "running" | "success" | "error";
}

export type AssistantStoreEvent =
  | { type: "run-start" }
  | { type: "text-delta"; delta: string }
  | { type: "assistant-message"; text: string; stopReason?: string }
  | {
      type: "command-start";
      toolCallId: string;
      commandType: string;
      args: unknown;
    }
  | {
      type: "command-end";
      toolCallId: string;
      commandType: string;
      isError: boolean;
      result: unknown;
    }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | {
      type: "tool-end";
      toolCallId: string;
      toolName: string;
      isError: boolean;
    }
  | { type: "first-mutation"; draftId: string }
  | {
      type: "run-end";
      draftId: string;
      firstMutationObserved: boolean;
      terminationReason: AssistantRunTerminationReason;
    }
  | { type: "error"; message: string };

/** Mirrors AssistantRunTerminationReason in @dashframe/assistant. */
export type AssistantRunTerminationReason =
  | "completed"
  | "aborted"
  | "error"
  | "failureCap"
  | "oscillation";

/**
 * Whether the assistant is visible. Panel geometry lives in the shell store.
 * This store holds only the open/closed state and its ⌘J summon.
 *
 * `pendingDraftId` is a transient draft waiting for user review. It is NOT
 * persisted — a persisted draftId could go stale across server restarts. The
 * pi-agent sets this when it produces a draft; the DraftReviewPanel reads it.
 */
interface AssistantState {
  /** Whether the assistant panel is visible. */
  isOpen: boolean;
  /**
   * A draft the assistant has queued for user review. When non-null the
   * assistant panel shows the DraftReviewPanel instead of the empty state.
   * Set by the pi-agent producer; cleared on publish or discard.
   */
  pendingDraftId: string | null;
  runStatus: AssistantRunStatus;
  activeDraftId: string | null;
  selectedProviderConfigId: string | null;
  selectedModelId: string | null;
  turns: AssistantTurn[];
  streamingText: string;
  error: string | null;
}

interface AssistantActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Set (or clear) a draft waiting for review. Opens the panel when non-null. */
  setPendingDraft: (id: string | null) => void;
  setSelectedModel: (providerConfigId: string, modelId: string) => void;
  beginRun: (prompt: string) => void;
  receiveRunEvent: (event: AssistantStoreEvent) => void;
  failRun: (message: string) => void;
  /** Client-side cancel (e.g. rail dismissed mid-run) — clean, not an error. */
  abortRun: () => void;
  clearTranscript: () => void;
}

/**
 * localStorage that swallows access failures (quota exceeded, Safari private
 * mode, blocked site storage). Persistence is a nice-to-have for a UI
 * preference — it must never let a write failure escape into a click handler
 * and break the assistant controls. SSR-safe: no-ops without `window`.
 */
const safeLocalStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Best-effort: drop the write rather than break the UI.
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Best-effort.
    }
  },
};

/**
 * Assistant open/closed state. Persists so the panel survives a reload in
 * whatever state the user left it.
 *
 * Uses a plain JSON storage rather than the shared superjson adapter: this
 * store holds only primitives (no Map/Set/Date), and the superjson adapter only
 * revives values carrying a `meta` marker — so a plain persisted object reads
 * back un-rehydrated and the state silently resets to default. Plain JSON
 * round-trips correctly here.
 *
 * `skipHydration: true` keeps SSR deterministic — the `StoreHydration` provider
 * rehydrates client-side after mount.
 */
export const useAssistantStore = create<AssistantState & AssistantActions>()(
  persist(
    (set) => ({
      isOpen: false,
      // Transient — not persisted. A stale draftId across a server restart
      // would surface a "draft not found" error in the review panel.
      pendingDraftId: null,
      runStatus: "idle",
      activeDraftId: null,
      selectedProviderConfigId: null,
      selectedModelId: null,
      turns: [],
      streamingText: "",
      error: null,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setPendingDraft: (id) =>
        set((s) => ({
          pendingDraftId: id,
          // Open the panel automatically when a draft is queued.
          isOpen: id !== null ? true : s.isOpen,
        })),
      setSelectedModel: (providerConfigId, modelId) =>
        set({
          selectedProviderConfigId: providerConfigId,
          selectedModelId: modelId,
        }),
      beginRun: (prompt) =>
        set((s) => ({
          isOpen: true,
          runStatus: "running",
          activeDraftId: null,
          // Clear any draft left pending by a previous run — its review
          // panel must not survive into the new run. If this run mutates,
          // first-mutation re-populates it.
          pendingDraftId: null,
          streamingText: "",
          error: null,
          turns: [
            ...s.turns,
            {
              id: makeTurnId("user"),
              kind: "user",
              text: prompt,
              status: "success",
            },
          ],
        })),
      receiveRunEvent: (event) => set((s) => applyAssistantEvent(s, event)),
      failRun: (message) =>
        set((s) => ({
          runStatus: "error",
          streamingText: "",
          error: message,
          turns: [
            ...flushStreamingTurn(s),
            {
              id: makeTurnId("error"),
              kind: "status",
              text: message,
              status: "error",
            },
          ],
        })),
      abortRun: () =>
        set((s) => {
          if (s.runStatus !== "running") return s;
          return {
            ...s,
            runStatus: "aborted",
            streamingText: "",
            turns: [
              ...flushStreamingTurn(s),
              {
                id: makeTurnId("aborted"),
                kind: "status",
                text: "Run cancelled",
                status: "success",
              },
            ],
          };
        }),
      clearTranscript: () =>
        set({
          runStatus: "idle",
          activeDraftId: null,
          turns: [],
          streamingText: "",
          error: null,
        }),
    }),
    {
      name: "dashframe:assistant",
      storage: createJSONStorage(() => safeLocalStorage),
      skipHydration: true,
      // Persist only last-open state; pendingDraftId is session-only.
      partialize: (s) => ({ isOpen: s.isOpen }),
    },
  ),
);

function terminationFailureMessage(
  reason: AssistantRunTerminationReason,
): string {
  switch (reason) {
    case "failureCap":
      return "Run stopped after repeated command failures.";
    case "oscillation":
      return "Run stopped after repeating itself without progress.";
    default:
      return "Run ended with an error.";
  }
}

let fallbackTurnCounter = 0;

function makeTurnId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? String(++fallbackTurnCounter);
  return `${prefix}-${id}`;
}

function formatCommandArgs(args: unknown): string {
  if (args === null || args === undefined) return "";
  try {
    const text = JSON.stringify(args);
    return text === "{}" ? "" : ` ${text}`;
  } catch {
    return "";
  }
}

function flushStreamingTurn(state: AssistantState): AssistantTurn[] {
  const text = state.streamingText.trim();
  if (!text) return state.turns;
  return [
    ...state.turns,
    {
      id: makeTurnId("assistant"),
      kind: "assistant",
      text,
      status: "success",
    },
  ];
}

function replaceTurn(
  turns: AssistantTurn[],
  id: string,
  update: Partial<AssistantTurn>,
): AssistantTurn[] {
  return turns.map((turn) => (turn.id === id ? { ...turn, ...update } : turn));
}

function finishToolTurn(
  state: AssistantState,
  event: Extract<AssistantStoreEvent, { type: "command-end" | "tool-end" }>,
): AssistantState {
  return {
    ...state,
    turns: replaceTurn(state.turns, event.toolCallId, {
      status: event.isError ? "error" : "success",
    }),
  };
}

function applyAssistantEvent(
  state: AssistantState,
  event: AssistantStoreEvent,
): AssistantState {
  switch (event.type) {
    case "run-start":
      return {
        ...state,
        runStatus: "running",
        error: null,
      };
    case "text-delta":
      return {
        ...state,
        streamingText: state.streamingText + event.delta,
      };
    case "assistant-message": {
      const turns = flushStreamingTurn({
        ...state,
        streamingText: state.streamingText || event.text,
      });
      return {
        ...state,
        streamingText: "",
        turns,
      };
    }
    case "command-start": {
      return {
        ...state,
        turns: [
          ...flushStreamingTurn(state),
          {
            id: event.toolCallId,
            kind: "command",
            text: `${event.commandType}${formatCommandArgs(event.args)}`,
            status: "running",
          },
        ],
        streamingText: "",
      };
    }
    case "command-end":
      return finishToolTurn(state, event);
    case "tool-start":
      return {
        ...state,
        turns: [
          ...flushStreamingTurn(state),
          {
            id: event.toolCallId,
            kind: "tool",
            text: event.toolName,
            status: "running",
          },
        ],
        streamingText: "",
      };
    case "tool-end":
      return finishToolTurn(state, event);
    case "first-mutation":
      return {
        ...state,
        activeDraftId: event.draftId,
        pendingDraftId: event.draftId,
        isOpen: true,
      };
    case "run-end": {
      let runStatus: AssistantRunStatus = "error";
      if (event.terminationReason === "completed") runStatus = "completed";
      else if (event.terminationReason === "aborted") runStatus = "aborted";
      // Abnormal terminations must leave a visible trace — without a status
      // turn the timeline just stops and the user gets no signal the run
      // ended early (the "error" SSE event doesn't fire for these).
      const failureMessage =
        runStatus === "error"
          ? terminationFailureMessage(event.terminationReason)
          : null;
      return {
        ...state,
        activeDraftId: event.draftId,
        runStatus,
        streamingText: "",
        error: failureMessage ?? state.error,
        turns: failureMessage
          ? [
              ...flushStreamingTurn(state),
              {
                id: makeTurnId("run-end"),
                kind: "status",
                text: failureMessage,
                status: "error",
              },
            ]
          : flushStreamingTurn(state),
      };
    }
    case "error":
      return {
        ...state,
        runStatus: "error",
        streamingText: "",
        error: event.message,
        turns: [
          ...flushStreamingTurn(state),
          {
            id: makeTurnId("error"),
            kind: "status",
            text: event.message,
            status: "error",
          },
        ],
      };
  }
}
