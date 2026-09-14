/**
 * Report writes while editing go into a draft, never straight to the saved
 * report. The edit page provides the writer; the grid, cells, popovers, and
 * item pane call `useReportWrite()` without knowing about drafts.
 *
 * Only the report itself is read through the draft. That holds because every
 * command the report editor sends writes the `dashboards` table; a command
 * that changed a chart or insight would need those reads threaded through the
 * draft as well.
 */

import { api } from "@dashframe/convex-backend/api";
import type { Command } from "@dashframe/types";
import { useMutation } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type ReportWrite = (args: { commands: Command[] }) => Promise<unknown>;

interface ReportDraft {
  write: ReportWrite;
  /** Waits for queued writes, then resolves to the draft they went into. */
  settle: () => Promise<string | undefined>;
}

const ReportDraftContext = createContext<ReportDraft | null>(null);

function missingProvider(): Promise<never> {
  return Promise.reject(
    new Error("Report writes need a ReportDraftProvider (the edit page)."),
  );
}

export function useReportWrite(): ReportWrite {
  return useContext(ReportDraftContext)?.write ?? missingProvider;
}

export function useReportDraft(): ReportDraft | null {
  return useContext(ReportDraftContext);
}

export function ReportDraftProvider({
  draftId,
  onDraftCreated,
  children,
}: {
  draftId: string | undefined;
  /** Called once, when the first write creates the draft. */
  onDraftCreated: (draftId: string) => void;
  children: ReactNode;
}) {
  const draftBatch = useMutation(api.app.draftBatch);
  const draftIdRef = useRef(draftId);
  // Writes run one at a time so the first one creates the draft and every
  // later one appends to it, even when two land together (drag and resize).
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  const write = useCallback<ReportWrite>(
    ({ commands }) => {
      const run = queueRef.current
        .catch(() => {})
        .then(async () => {
          const current = draftIdRef.current;
          const result = await draftBatch({
            commands,
            ...(current ? { draftId: current } : {}),
          });
          if (!current) {
            draftIdRef.current = result.draftId;
            onDraftCreated(result.draftId);
          }
          return result;
        });
      queueRef.current = run;
      return run;
    },
    [draftBatch, onDraftCreated],
  );

  const settle = useCallback(
    () => queueRef.current.catch(() => {}).then(() => draftIdRef.current),
    [],
  );

  const value = useMemo(() => ({ write, settle }), [settle, write]);

  return (
    <ReportDraftContext.Provider value={value}>
      {children}
    </ReportDraftContext.Provider>
  );
}
