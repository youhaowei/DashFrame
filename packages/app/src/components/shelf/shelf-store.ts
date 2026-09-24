/**
 * SPIKE: the shelf's items, kept in localStorage so every open tab of the app
 * shows the same shelf. Another tab's write arrives as a `storage` event; this
 * tab's own write never fires one, so writes also notify locally.
 */
import { useSyncExternalStore } from "react";

export type ShelfItemKind = "metric" | "chart";

export interface ShelfMetricRef {
  /** The table that owns the saved metric. */
  tableId: string;
  /** The saved (table-owned) metric's id. */
  metricId: string;
  /** Definition, so a chart can find its own copy of the metric. */
  aggregation: string;
  columnName?: string;
}

export interface ShelfChartRef {
  reportId: string;
  visualizationId: string;
}

export type ShelfItem =
  | { id: string; kind: "metric"; label: string; ref: ShelfMetricRef }
  | { id: string; kind: "chart"; label: string; ref: ShelfChartRef };

export const SHELF_STORAGE_KEY = "dashframe.shelf.v1";
export const SHELF_CAPACITY = 8;
const LOCAL_EVENT = "dashframe:shelf";

const EMPTY: readonly ShelfItem[] = [];
let cachedRaw: string | null = null;
let cachedItems: readonly ShelfItem[] = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SHELF_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): readonly ShelfItem[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? (value as ShelfItem[]).slice(0, SHELF_CAPACITY)
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): readonly ShelfItem[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedItems = parse(raw);
  }
  return cachedItems;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHELF_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

function write(items: readonly ShelfItem[]): void {
  try {
    window.localStorage.setItem(SHELF_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the shelf simply does not change.
  }
  window.dispatchEvent(new Event(LOCAL_EVENT));
}

export function useShelfItems(): readonly ShelfItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/** The key that makes two shelf items the same thing. */
export function shelfItemKey(item: ShelfItem): string {
  return item.kind === "metric"
    ? `metric:${item.ref.metricId}`
    : `chart:${item.ref.visualizationId}`;
}

export type AddResult = "added" | "already" | "full";

export function addToShelf(item: ShelfItem): AddResult {
  const items = getSnapshot();
  const key = shelfItemKey(item);
  if (items.some((existing) => shelfItemKey(existing) === key)) {
    return "already";
  }
  if (items.length >= SHELF_CAPACITY) return "full";
  write([...items, item]);
  return "added";
}

export function removeFromShelf(id: string): void {
  write(getSnapshot().filter((item) => item.id !== id));
}
