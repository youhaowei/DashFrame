import { create } from "zustand";

/**
 * Drafts whose tab was closed this session. Closing a tab only takes it off
 * the strip — the draft is still waiting for review. A link to it shows it
 * while that link is open, and "Open drafts" (offered once every tab is
 * closed) brings all of them back. Not persisted: a fresh session shows every
 * draft again.
 */
interface ClosedDraftTabs {
  closed: ReadonlySet<string>;
  close: (draftId: string) => void;
  reopenAll: () => void;
}

export const useClosedDraftTabs = create<ClosedDraftTabs>()((set) => ({
  closed: new Set(),
  close: (draftId) =>
    set((state) => ({ closed: new Set(state.closed).add(draftId) })),
  reopenAll: () => set({ closed: new Set() }),
}));
