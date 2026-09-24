import { AppLayout } from "@/components/layouts/AppLayout";
import { useAppBreadcrumbs } from "@/components/shell/app-breadcrumbs";
import { useTopBarTabs } from "@/components/shell/topbar-tabs";
import {
  DRAFT_DRIFT_DESCRIPTION,
  draftLifecycleErrorDescription,
  isDriftError,
} from "@/components/preview-diff/user-facing-errors";
import {
  Workbench,
  WorkbenchPaneToggle,
  useWorkbenchPanes,
} from "@/components/workbench/Workbench";
import { queryStatus } from "@/data/query-status";
import { getConvexClient } from "@/data/runtime";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { api } from "@dashframe/convex-backend/api";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@wystack/ui-react";
import {
  CheckIcon,
  DeleteIcon,
  FileIcon,
  MoreIcon,
} from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { ChangeInspector } from "./ChangeInspector";
import { useClosedDraftTabs } from "./closed-draft-tabs";
import { DraftChangeList } from "./DraftChangeList";
import { DraftConfigPane } from "./DraftConfigPane";
import { OpenChartButton } from "./OpenChartButton";
import {
  draftChanges,
  draftLabels,
  mostRecentDraft,
  sortDrafts,
  type DraftReview,
  type DraftSummary,
} from "./draft-review";

const DRAFT_PANEL_ID = "draft-review-panel";
const NO_DRAFTS: DraftSummary[] = [];

type RevisionOp =
  | { type: "removeCommand"; commandIndex: number }
  | {
      type: "bindOperand";
      commandIndex: number;
      jsonPath: string;
      value: string;
    };

interface DraftsPageContentProps {
  /** The open draft tab from the URL; the most recent draft when absent. */
  draftId: string | null;
}

const DRAFTS_TRAIL = [{ label: "Drafts" }];

function lifecycleMessage(error: unknown): string {
  return isDriftError(error)
    ? DRAFT_DRIFT_DESCRIPTION
    : draftLifecycleErrorDescription(error);
}

function CentreMessage({
  title,
  line,
  action,
  role,
}: {
  title: string;
  line: string;
  action?: ReactNode;
  role?: "alert";
}) {
  return (
    <div
      role={role}
      className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center"
    >
      <h2 className="text-base font-semibold text-neutral-fg">{title}</h2>
      <p className="text-sm text-neutral-fg-subtle">{line}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function CentreLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-neutral-fg-subtle">{label}</p>
    </div>
  );
}

/**
 * Drafts page: every draft waiting for review as a top-bar tab, the open
 * draft's origin and scope on the left, its changes in the centre, and the
 * selected change's inspector on the right.
 */
export default function DraftsPageContent({ draftId }: DraftsPageContentProps) {
  const navigate = useNavigate();
  const {
    data: loadedDrafts,
    isLoading: isLoadingDrafts,
    isError: isDraftsError,
  } = queryStatus(useQuery({ query: api.app.listDrafts, args: {} }));
  // Drafts this page published or discarded. The subscription can list one
  // for a moment after its mutation returns (or for as long as the
  // connection is down); skipping them keeps a finished draft from being
  // chosen, and pinned back into the URL, as the next draft.
  const [finished, setFinished] = useState<ReadonlySet<string>>(new Set());
  const drafts = sortDrafts(loadedDrafts ?? NO_DRAFTS).filter(
    (draft) => !finished.has(draft.draftId),
  );
  const closed = useClosedDraftTabs((state) => state.closed);
  const closeTab = useClosedDraftTabs((state) => state.close);
  const reopenAll = useClosedDraftTabs((state) => state.reopenAll);

  // The draft in the URL is always open; without one, the most recent open
  // draft is. A stale id (published or discarded elsewhere) falls back too.
  const openDrafts = drafts.filter(
    (draft) => !closed.has(draft.draftId) || draft.draftId === draftId,
  );
  const selectedDraft =
    drafts.find((draft) => draft.draftId === draftId) ??
    mostRecentDraft(openDrafts) ??
    null;

  const {
    data: loadedReview,
    isLoading: isLoadingReview,
    isError: isReviewError,
  } = queryStatus(
    useQuery({
      query: api.app.draftPublishReview,
      args: selectedDraft ? { draftId: selectedDraft.draftId } : "skip",
    }),
  );
  // A review for the previous tab never shows under the next one.
  const review =
    loadedReview && loadedReview.draftId === selectedDraft?.draftId
      ? (loadedReview as DraftReview)
      : undefined;

  const publish = useMutation(api.app.publishDraft);
  const discard = useMutation(api.app.discardDraft);
  const revise = useMutation(api.app.reviseDraft);
  const { confirm } = useConfirmDialogStore();
  const [busy, setBusy] = useState<"publish" | "discard" | "revise" | null>(
    null,
  );
  // Selections and errors belong to the draft they were made on.
  const [selection, setSelection] = useState({ draftId: "", key: "" });
  const [reviewError, setReviewError] = useState({
    draftId: "",
    message: "",
  });

  const changes = review ? draftChanges(review) : [];
  const selectedChange =
    selection.draftId === selectedDraft?.draftId
      ? (changes.find((change) => change.key === selection.key) ?? null)
      : null;
  const shownReviewError =
    reviewError.draftId === selectedDraft?.draftId && reviewError.message
      ? reviewError.message
      : null;

  const { leftOpen, rightOpen, setRightOpen, toggleLeft, toggleRight } =
    useWorkbenchPanes("draft");

  const selectDraft = (id: string) =>
    navigate({
      to: "/drafts/$draftId",
      params: { draftId: id },
      // Switching tabs is not a page visit; Back leaves the drafts.
      replace: true,
    });
  const closeDraftTab = (id: string) => {
    closeTab(id);
    if (id !== selectedDraft?.draftId) return;
    const next = mostRecentDraft(
      openDrafts.filter((draft) => draft.draftId !== id),
    );
    if (next) void selectDraft(next.draftId);
    else void navigate({ to: "/drafts", replace: true });
  };
  // `/drafts` and a stale link resolve to a draft once; the URL then names it,
  // so another draft updating in the background never takes its place.
  const resolvedDraftId = selectedDraft?.draftId ?? null;
  useEffect(() => {
    if (resolvedDraftId && resolvedDraftId !== draftId)
      void navigate({
        to: "/drafts/$draftId",
        params: { draftId: resolvedDraftId },
        replace: true,
      });
  }, [draftId, navigate, resolvedDraftId]);
  useDraftTabs(
    selectedDraft ? openDrafts : NO_DRAFTS,
    selectedDraft?.draftId ?? null,
    selectDraft,
    closeDraftTab,
  );
  // The open drafts are the tabs, so the trail ends at the section.
  useAppBreadcrumbs(DRAFTS_TRAIL);

  const selectChange = (key: string) => {
    if (!selectedDraft) return;
    setSelection({ draftId: selectedDraft.draftId, key });
    // Choosing a change asks to inspect it, even if the pane was collapsed.
    setRightOpen(true);
  };

  const runRevision = async (op: RevisionOp): Promise<boolean> => {
    if (!review) return false;
    setBusy("revise");
    setReviewError({ draftId: review.draftId, message: "" });
    try {
      await revise({
        draftId: review.draftId,
        expectedLogSignature: review.logSignature,
        ops: [op],
      });
      return true;
    } catch (error) {
      setReviewError({
        draftId: review.draftId,
        message: lifecycleMessage(error),
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  /**
   * After a publish or discard: remember the draft as finished and open the
   * most recent draft still waiting, by id. Resolves to that id, or null when
   * none is left.
   */
  const leaveFinishedDraft = async (id: string): Promise<string | null> => {
    const done = new Set(finished).add(id);
    setFinished(done);
    let remaining = drafts;
    try {
      remaining = await getConvexClient().query(api.app.listDrafts, {});
    } catch {
      // The mutation has already succeeded, so a failed refresh must not fail
      // the action. Fall through on the drafts already in hand.
    }
    const next = mostRecentDraft(
      remaining.filter((draft) => !done.has(draft.draftId)),
    );
    if (!next) return null;
    void selectDraft(next.draftId);
    return next.draftId;
  };

  const handlePublish = async () => {
    if (!review || review.publishBlocked) return;
    const publishedId = review.draftId;
    setBusy("publish");
    setReviewError({ draftId: publishedId, message: "" });
    try {
      await publish({
        draftId: publishedId,
        expectedCommandCount: String(review.commandCount),
        expectedLogSignature: review.logSignature,
      });
      toast.success("Draft published");
      const next = await leaveFinishedDraft(publishedId);
      if (!next) void navigate({ to: "/", replace: true });
    } catch (error) {
      const message = lifecycleMessage(error);
      setReviewError({ draftId: publishedId, message });
      toast.error("Failed to publish draft", { description: message });
    } finally {
      setBusy(null);
    }
  };

  const handleDiscard = () => {
    if (!selectedDraft) return;
    const { draftId: discardedId, commandCount } = selectedDraft;
    confirm({
      title: "Discard draft",
      description:
        commandCount === 1
          ? "Discard this change? Nothing in the draft has been published."
          : `Discard all ${commandCount} changes? Nothing in the draft has been published.`,
      confirmLabel: "Discard draft",
      variant: "destructive",
      onConfirm: async () => {
        setBusy("discard");
        try {
          await discard({ draftId: discardedId });
          toast.success("Draft discarded");
          const next = await leaveFinishedDraft(discardedId);
          if (!next) void navigate({ to: "/drafts", replace: true });
        } catch (error) {
          toast.error("Failed to discard draft", {
            description: lifecycleMessage(error),
          });
        } finally {
          setBusy(null);
        }
      },
    });
  };

  if (isLoadingDrafts || isDraftsError || !selectedDraft) {
    return (
      <AppLayout pageHeader={null} childrenClassName="overflow-hidden">
        <Workbench>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg-muted p-2 shadow-inner dark:bg-neutral-bg-dim">
            <NoOpenDraft
              status={draftsStatusOf(isLoadingDrafts, isDraftsError)}
              waiting={drafts.length}
              onReopenAll={reopenAll}
            />
          </div>
        </Workbench>
      </AppLayout>
    );
  }

  const centre = review ? (
    <DraftChangeList
      review={review}
      changes={changes}
      selectedKey={selectedChange?.key ?? null}
      onSelect={selectChange}
      reviewError={shownReviewError}
      onRetry={() => globalThis.location.reload()}
      busy={busy !== null}
      onBindValue={(commandIndex, jsonPath, value) =>
        runRevision({ type: "bindOperand", commandIndex, jsonPath, value })
      }
    />
  ) : (
    <ReviewUnavailable pending={isLoadingReview || !isReviewError} />
  );

  const title = draftLabels(drafts).get(selectedDraft.draftId) ?? "";

  return (
    <AppLayout pageHeader={null} childrenClassName="overflow-hidden">
      <Workbench
        data-dashframe-draft-id={selectedDraft.draftId}
        leftOpen={leftOpen}
        left={
          <DraftConfigPane
            draft={selectedDraft}
            review={review}
            changeCount={review ? changes.length : undefined}
          />
        }
        rightOpen={rightOpen && selectedChange !== null}
        right={
          selectedChange ? (
            <ChangeInspector
              // Remount per change so a pending remove confirm never carries over.
              key={selectedChange.key}
              change={selectedChange}
              busy={busy !== null}
              onRemoveStep={(commandIndex) =>
                runRevision({ type: "removeCommand", commandIndex })
              }
              openAction={
                selectedChange.type === "node" &&
                selectedChange.node.kind === "visualization" ? (
                  <OpenChartButton
                    visualizationId={selectedChange.node.nodeId}
                  />
                ) : undefined
              }
            />
          ) : null
        }
      >
        {/* Collapses by the header's own width, as the source header does. */}
        <header className="@container flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto px-1 whitespace-nowrap [scrollbar-width:thin] [&>*]:shrink-0 [&>h1]:shrink">
          <WorkbenchPaneToggle
            side="left"
            open={leftOpen}
            paneName="Draft"
            onToggle={toggleLeft}
          />
          {/* Where the draft sits is in the app bar's breadcrumb. */}
          <h1
            title={title}
            className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-neutral-fg"
          >
            {title}
          </h1>
          <Button
            size="sm"
            icon={CheckIcon}
            label="Publish"
            loading={busy === "publish"}
            disabled={!review || review.publishBlocked || busy !== null}
            onClick={() => void handlePublish()}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  label="More draft actions"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={MoreIcon}
                />
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={busy !== null}
                onClick={handleDiscard}
                className="text-palette-danger focus:text-palette-danger"
              >
                <DeleteIcon className="mr-2 h-4 w-4" />
                Discard draft
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedChange && (
            <WorkbenchPaneToggle
              side="right"
              open={rightOpen}
              paneName="Change"
              onToggle={toggleRight}
            />
          )}
        </header>

        <div
          id={DRAFT_PANEL_ID}
          role="tabpanel"
          aria-label={title}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] bg-neutral-bg-muted p-2 shadow-inner dark:bg-neutral-bg-dim"
        >
          {centre}
        </div>
      </Workbench>
    </AppLayout>
  );
}

type DraftsStatus = "loading" | "error" | "ready";

function draftsStatusOf(isLoading: boolean, isError: boolean): DraftsStatus {
  if (isLoading) return "loading";
  return isError ? "error" : "ready";
}

/**
 * The centre when no draft is open: the list still loading or failed, every
 * tab closed, or nothing waiting for review — one heading, one line.
 */
function NoOpenDraft({
  status,
  waiting,
  onReopenAll,
}: {
  status: DraftsStatus;
  waiting: number;
  onReopenAll: () => void;
}) {
  if (status === "loading") return <CentreLoading label="Loading drafts…" />;
  if (status === "error")
    return (
      <CentreMessage
        role="alert"
        title="Couldn't load drafts"
        line="Something went wrong. Check your connection and try again."
        action={<ReloadButton />}
      />
    );
  if (waiting > 0)
    return (
      <CentreMessage
        title="No drafts open"
        line={`${waiting} draft${waiting === 1 ? " is" : "s are"} waiting for review.`}
        action={
          <Button variant="outline" label="Open drafts" onClick={onReopenAll} />
        }
      />
    );
  return (
    <CentreMessage
      title="No changes waiting for review"
      line="When an agent proposes changes to your project, they wait here until you publish them."
    />
  );
}

function ReloadButton() {
  return (
    <Button
      variant="outline"
      label="Try again"
      onClick={() => globalThis.location.reload()}
    />
  );
}

/** The open draft's review is still loading, or failed to load. */
function ReviewUnavailable({ pending }: { pending: boolean }) {
  if (pending) return <CentreLoading label="Loading draft…" />;
  return (
    <CentreMessage
      role="alert"
      title="Couldn't load this draft"
      line="Something went wrong. Check your connection and try again."
      action={<ReloadButton />}
    />
  );
}

/**
 * Shows the open drafts as top-bar tabs while one is open. The strip is
 * rebuilt only when what it shows changes — the tab ids, labels, or the
 * active tab — so a page render does not re-register it; the handlers are
 * read at call time.
 */
function useDraftTabs(
  drafts: DraftSummary[],
  activeDraftId: string | null,
  onSelect: (draftId: string) => void,
  onClose: (draftId: string) => void,
) {
  const handlers = useRef({ onSelect, onClose });
  useLayoutEffect(() => {
    handlers.current = { onSelect, onClose };
  });
  const shown = activeDraftId ? JSON.stringify([...draftLabels(drafts)]) : null;
  const tabs = useMemo(() => {
    if (shown === null || activeDraftId === null) return null;
    const entries = JSON.parse(shown) as Array<[string, string]>;
    return {
      label: "Drafts",
      tabs: entries.map(([id, label]) => ({
        id,
        label,
        icon: <FileIcon className="size-3.5" />,
        closable: true,
      })),
      activeId: activeDraftId,
      onSelect: (id: string) => handlers.current.onSelect(id),
      onClose: (id: string) => handlers.current.onClose(id),
      panelId: DRAFT_PANEL_ID,
      findLabel: "Find a draft",
      findEmptyLabel: "No matching drafts.",
    };
  }, [shown, activeDraftId]);
  useTopBarTabs(tabs);
}
