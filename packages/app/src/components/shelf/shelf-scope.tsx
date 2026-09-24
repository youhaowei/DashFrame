import { queryStatus } from "@/data/query-status";
import { getRuntimeConfig } from "@/data/runtime";
import { api } from "@dashframe/convex-backend/api";
import { useQuery_experimental as useQuery } from "convex/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import {
  putOnShelf,
  removeFromShelf,
  setShelfItemPinned,
  shelfStorageKey,
  useShelfItems,
  type ShelfItemRef,
} from "./shelf-store";

/** The signed-in account on a hosted deployment; local mode has none. */
function hostedAccount(): string | undefined {
  try {
    const config = getRuntimeConfig() as { subject?: unknown };
    return typeof config.subject === "string" ? config.subject : undefined;
  } catch {
    return undefined;
  }
}

const ShelfScopeContext = createContext<string | null>(null);

/**
 * Names the shelf the tree below works on: the open project's, and on a
 * hosted deployment the signed-in account's. It is derived during render, so
 * the first render of a new shell already reads its own shelf, and it goes
 * with the tree when the shell unmounts. `null` until the project is known.
 */
export function ShelfScope({
  children,
  storageKey,
}: {
  children: ReactNode;
  /** Fixed scope, for tests and stories; otherwise read from the host. */
  storageKey?: string | null;
}) {
  const { data } = queryStatus(
    useQuery({
      query: api.app.projectInfo,
      args: storageKey === undefined ? {} : "skip",
    }),
  );
  const projectId = data?.projectId;
  const derived = useMemo(
    () => (projectId ? shelfStorageKey(projectId, hostedAccount()) : null),
    [projectId],
  );
  return (
    <ShelfScopeContext.Provider
      value={storageKey === undefined ? derived : storageKey}
    >
      {children}
    </ShelfScopeContext.Provider>
  );
}

function report(saved: boolean, storageKey: string | null): void {
  if (saved) return;
  toast.error(
    storageKey
      ? "Couldn't change the shelf: this browser's storage is full or blocked."
      : "The shelf isn't ready yet. Try again in a moment.",
  );
}

/**
 * The current scope's shelf and its changes. A change the browser refuses
 * (full or blocked storage, or no project yet) says so.
 */
export function useShelf() {
  const storageKey = useContext(ShelfScopeContext);
  const items = useShelfItems(storageKey);
  return useMemo(
    () => ({
      items,
      put: (ref: ShelfItemRef) =>
        report(putOnShelf(storageKey, ref), storageKey),
      pin: (key: string, pinned: boolean) =>
        report(setShelfItemPinned(storageKey, key, pinned), storageKey),
      remove: (key: string) =>
        report(removeFromShelf(storageKey, key), storageKey),
    }),
    [items, storageKey],
  );
}
