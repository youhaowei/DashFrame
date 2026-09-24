/**
 * What the shelf shows, derived from what it stores. Pure, so the rules can
 * be tested without a browser: an item is checked against the live artifact
 * lists every render, and against the current page's drop targets.
 */
import type { RegisteredDropTarget } from "./drag-context";
import type { ShelfItem } from "./shelf-store";

/** The live lists an item resolves against; `undefined` while loading. */
export interface ShelfLiveLists {
  tables?: ReadonlyArray<{
    id: string;
    fields: ReadonlyArray<{ id: string; name: string }>;
    metrics: ReadonlyArray<{ id: string; name: string }>;
  }>;
  visualizations?: ReadonlyArray<{ id: string; name: string }>;
  drafts?: ReadonlyArray<{ draftId: string; title: string | null }>;
}

export type ShelfItemState =
  /** Found: `label` is its current name. */
  | { status: "live"; label: string }
  /** Its list has not loaded yet: show the stored name as it is. */
  | { status: "loading"; label: string }
  /** Deleted, or never reachable from here: show it muted, offer ×. */
  | { status: "missing"; label: string };

function found(name: string | null | undefined, fallback: string) {
  return { status: "live", label: name?.trim() || fallback } as const;
}

export function resolveShelfItem(
  item: ShelfItem,
  lists: ShelfLiveLists,
): ShelfItemState {
  const loading = { status: "loading", label: item.label } as const;
  const missing = { status: "missing", label: item.label } as const;
  switch (item.kind) {
    case "metric":
    case "field": {
      if (!lists.tables) return loading;
      const table = lists.tables.find((entry) => entry.id === item.scope);
      const members = item.kind === "metric" ? table?.metrics : table?.fields;
      const member = members?.find((entry) => entry.id === item.id);
      return member ? found(member.name, item.label) : missing;
    }
    case "chart": {
      if (!lists.visualizations) return loading;
      const chart = lists.visualizations.find((entry) => entry.id === item.id);
      return chart ? found(chart.name, "Untitled chart") : missing;
    }
    case "draft": {
      if (!lists.drafts) return loading;
      const draft = lists.drafts.find((entry) => entry.draftId === item.id);
      return draft ? found(draft.title, item.label) : missing;
    }
  }
}

export interface ShelfPagePartition {
  /** Items a target on this page takes, or every item when it has none. */
  usable: ShelfItem[];
  /** Items no target on this page takes: the "Not for this page" row. */
  elsewhere: ShelfItem[];
}

/**
 * Splits the shelf by what the current page can use. Only page targets
 * count; the shelf itself takes anything. A page with no page targets (a
 * list page, or any page before its targets exist) shows every item, since
 * there is nothing on it to compare against.
 */
export function partitionForPage(
  items: readonly ShelfItem[],
  targets: readonly RegisteredDropTarget[],
): ShelfPagePartition {
  const pageTargets = targets.filter((target) => target.role === "page");
  if (pageTargets.length === 0) return { usable: [...items], elsewhere: [] };
  const usable: ShelfItem[] = [];
  const elsewhere: ShelfItem[] = [];
  for (const item of items) {
    const takes = pageTargets.some(
      (target) => target.accepts(item, "shelf").ok,
    );
    (takes ? usable : elsewhere).push(item);
  }
  return { usable, elsewhere };
}
