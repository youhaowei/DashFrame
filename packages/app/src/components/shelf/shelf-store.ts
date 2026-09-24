/**
 * The shelf: items the user put aside to carry to another page. It lives in
 * localStorage, per device, so every open tab of the app shows the same
 * shelf. Another tab's write arrives as a `storage` event; the writing tab
 * never receives its own, so writes also notify this tab directly.
 *
 * Storage is the only source of truth: every change reads the stored list,
 * edits it, and writes it back, so a write in one tab builds on what another
 * tab wrote before it.
 *
 * Each project has its own shelf. One origin can serve several projects over
 * time (another workspace, another local project), and an item from one means
 * nothing in the other, so the key carries the project's id. Until the shelf
 * knows which project is open it reads empty and refuses writes.
 */
import { useSyncExternalStore } from "react";

export const SHELF_KINDS = ["chart", "draft", "field", "metric"] as const;
export type ShelfKind = (typeof SHELF_KINDS)[number];

/**
 * A reference to something the user can carry, never its data. `scope` is
 * what the item belongs to: the table for a metric or field, the insight for
 * a chart or draft.
 */
export interface ShelfItem {
  kind: ShelfKind;
  id: string;
  scope: string;
  /** The name when it was put on the shelf; the live name wins when known. */
  label: string;
  pinned: boolean;
}

/** What a drag source hands over: pinning is the shelf's business. */
export type ShelfItemRef = Omit<ShelfItem, "pinned">;

const SHELF_STORAGE_PREFIX = "dashframe.shelf.v1";
/** Recent items kept; the oldest unpinned one drops off past this. */
export const SHELF_RECENT_LIMIT = 8;
const LOCAL_EVENT = "dashframe:shelf";

const EMPTY: readonly ShelfItem[] = [];
let storageKey: string | null = null;
let cachedKey: string | null = null;
let cachedRaw: string | null = null;
let cachedItems: readonly ShelfItem[] = EMPTY;

/** The storage key of a project's shelf. */
export function shelfStorageKey(projectId: string): string {
  return `${SHELF_STORAGE_PREFIX}:${projectId}`;
}

/**
 * Points the shelf at the open project's items, or at none while the project
 * is unknown. Every reader re-renders with that project's shelf.
 */
export function setShelfProject(projectId: string | null): void {
  const next = projectId ? shelfStorageKey(projectId) : null;
  if (next === storageKey) return;
  storageKey = next;
  window.dispatchEvent(new Event(LOCAL_EVENT));
}

/** The key that makes two shelf items the same thing. */
export function shelfItemKey(item: Pick<ShelfItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

function isShelfItem(value: unknown): value is ShelfItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    SHELF_KINDS.includes(item.kind as ShelfKind) &&
    typeof item.id === "string" &&
    typeof item.scope === "string" &&
    typeof item.label === "string" &&
    typeof item.pinned === "boolean"
  );
}

/** Reads a stored shelf, keeping only well-formed, distinct items. */
export function parseShelf(raw: string | null): readonly ShelfItem[] {
  if (!raw) return EMPTY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(value)) return EMPTY;
  const seen = new Set<string>();
  const items: ShelfItem[] = [];
  for (const entry of value) {
    if (!isShelfItem(entry)) continue;
    const key = shelfItemKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const { kind, id, scope, label, pinned } = entry;
    items.push({ kind, id, scope, label, pinned });
  }
  return capRecent(items);
}

/** Drops the oldest unpinned items past the recent limit. Newest come first. */
function capRecent(items: readonly ShelfItem[]): ShelfItem[] {
  let recent = 0;
  return items.filter((item) => item.pinned || ++recent <= SHELF_RECENT_LIMIT);
}

function readRaw(): string | null {
  if (!storageKey) return null;
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function getSnapshot(): readonly ShelfItem[] {
  const raw = readRaw();
  if (raw !== cachedRaw || storageKey !== cachedKey) {
    cachedKey = storageKey;
    cachedRaw = raw;
    cachedItems = parseShelf(raw);
  }
  return cachedItems;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // `key` is null when another tab clears all of storage.
    if (event.key === null || event.key === storageKey) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

function write(items: readonly ShelfItem[]): boolean {
  if (!storageKey) return false;
  let saved = true;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    saved = false;
  }
  window.dispatchEvent(new Event(LOCAL_EVENT));
  return saved;
}

/** The shelf as stored, newest first. */
export function useShelfItems(): readonly ShelfItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function readShelf(): readonly ShelfItem[] {
  return getSnapshot();
}

/**
 * Puts an item on the shelf, or moves it to the front if it is already
 * there (keeping its pin and taking the newer label). Returns false when
 * storage refused the write.
 */
export function putOnShelf(ref: ShelfItemRef): boolean {
  const items = getSnapshot();
  const key = shelfItemKey(ref);
  const existing = items.find((item) => shelfItemKey(item) === key);
  const item: ShelfItem = {
    kind: ref.kind,
    id: ref.id,
    scope: ref.scope,
    label: ref.label,
    pinned: existing?.pinned ?? false,
  };
  return write(
    capRecent([item, ...items.filter((other) => shelfItemKey(other) !== key)]),
  );
}

/**
 * Pins or unpins an item. An unpinned item becomes the newest recent one, so
 * unpinning never makes the recent limit drop the item just released.
 */
export function setShelfItemPinned(key: string, pinned: boolean): boolean {
  const items = getSnapshot();
  const item = items.find((entry) => shelfItemKey(entry) === key);
  if (!item) return true;
  if (pinned) {
    return write(
      items.map((entry) => (entry === item ? { ...entry, pinned } : entry)),
    );
  }
  const others = items.filter((entry) => entry !== item);
  return write(capRecent([{ ...item, pinned: false }, ...others]));
}

export function removeFromShelf(key: string): boolean {
  return write(getSnapshot().filter((item) => shelfItemKey(item) !== key));
}

/** "Shelf, 3 items": the shelf's accessible name with its count. */
export function shelfCountLabel(count: number): string {
  if (count === 0) return "Shelf";
  return `Shelf, ${count} ${count === 1 ? "item" : "items"}`;
}
