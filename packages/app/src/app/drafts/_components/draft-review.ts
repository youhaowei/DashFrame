import type { LateBoundEntry } from "@/components/drafts/LateBoundFixControl";
import type { api } from "@dashframe/convex-backend/api";
import type {
  PreviewDiff,
  PreviewDirectNode,
  PreviewDownstreamNode,
} from "@dashframe/types";
import type { FunctionReturnType } from "convex/server";

export type DraftSummary = FunctionReturnType<
  typeof api.app.listDrafts
>[number];
export type DraftReview = FunctionReturnType<typeof api.app.draftPublishReview>;

/**
 * One change in the centre list. Most are the artifacts the draft touches,
 * with the draft's commands grouped under them. A command the preview could
 * not reach — the one that fails and any after it — has no artifact yet, so
 * it stands as its own step.
 */
export type DraftChange =
  | {
      type: "node";
      key: string;
      node: PreviewDirectNode;
      /** The draft's commands behind this artifact, in draft order. */
      commandIndexes: number[];
      lateBound: LateBoundEntry[];
      downstream: PreviewDownstreamNode[];
    }
  | {
      type: "step";
      key: string;
      commandIndex: number;
      path: string;
      /** The command the preview stopped at; later steps were not reached. */
      failing: boolean;
      lateBound: LateBoundEntry[];
    };

export function draftChanges(review: DraftReview): DraftChange[] {
  const diff = review.diff as PreviewDiff;
  const lateBound = review.lateBound as LateBoundEntry[];
  const covered = new Set<number>();
  const changes: DraftChange[] = diff.directNodes.map((node) => {
    const commandIndexes = node.intent.map((intent) => intent.commandIndex);
    for (const index of commandIndexes) covered.add(index);
    return {
      type: "node",
      key: `node:${node.kind}:${node.nodeId}`,
      node,
      commandIndexes,
      lateBound: lateBound.filter((entry) =>
        commandIndexes.includes(entry.commandIndex),
      ),
      downstream: diff.affectedDownstream.filter(
        (entry) => entry.via.kind === node.kind && entry.via.id === node.nodeId,
      ),
    };
  });
  review.commands.forEach((command, index) => {
    if (covered.has(index)) return;
    changes.push({
      type: "step",
      key: `step:${index}`,
      commandIndex: index,
      path: command.path,
      failing: diff.error?.commandIndex === index,
      lateBound: lateBound.filter((entry) => entry.commandIndex === index),
    });
  });
  return changes;
}

/** "setInsightFilter" → "Set insight filter", for a step with no summary. */
export function describePath(path: string): string {
  const words = path
    .replace(/Cmd$/, "")
    .replaceAll(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type DraftStatus =
  | { tone: "ready"; label: string }
  | { tone: "blocked"; label: string };

/** Whether the draft can publish, and if not, the one reason that decides it. */
export function draftStatus(review: DraftReview): DraftStatus {
  const unbound = review.lateBound.length;
  if (review.commandCount === 0)
    return { tone: "blocked", label: "No changes yet" };
  if ((review.diff as PreviewDiff).error)
    return { tone: "blocked", label: "A change can't be applied" };
  if (unbound > 0)
    return {
      tone: "blocked",
      label: `${unbound} value${unbound === 1 ? "" : "s"} to fill in`,
    };
  return { tone: "ready", label: "Ready to publish" };
}

function epoch(value: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Drafts in the order they were made, so a tab keeps its place. */
export function sortDrafts(drafts: DraftSummary[]): DraftSummary[] {
  return drafts.toSorted((a, b) => epoch(a.createdAt) - epoch(b.createdAt));
}

/** The draft touched last; what `/drafts` opens. */
export function mostRecentDraft(
  drafts: DraftSummary[],
): DraftSummary | undefined {
  return drafts.reduce<DraftSummary | undefined>(
    (latest, draft) =>
      !latest ||
      epoch(draft.updatedAt ?? draft.createdAt) >
        epoch(latest.updatedAt ?? latest.createdAt)
        ? draft
        : latest,
    undefined,
  );
}

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function baseLabel(draft: DraftSummary): string {
  return draft.title ?? "Empty draft";
}

/**
 * Each draft's tab label, keyed by id. A label two drafts share gets the time
 * each was created ("… · 4:27 PM"), and the date too when the times collide.
 */
export function draftLabels(drafts: DraftSummary[]): Map<string, string> {
  const withSuffix = (
    labels: Map<string, string>,
    format: Intl.DateTimeFormat,
  ): Map<string, string> => {
    const counts = new Map<string, number>();
    for (const label of labels.values())
      counts.set(label, (counts.get(label) ?? 0) + 1);
    return new Map(
      drafts.map((draft) => {
        const label = labels.get(draft.draftId)!;
        const created = epoch(draft.createdAt);
        return [
          draft.draftId,
          (counts.get(label) ?? 0) > 1 && created > 0
            ? `${baseLabel(draft)} · ${format.format(created)}`
            : label,
        ];
      }),
    );
  };
  const base = new Map(
    drafts.map((draft) => [draft.draftId, baseLabel(draft)]),
  );
  return withSuffix(withSuffix(base, TIME), DATE_TIME);
}
