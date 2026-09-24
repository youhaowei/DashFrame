/**
 * One drag context for the whole app, mounted above the router's outlet so a
 * drag started on one page's source can land on any target that page shows,
 * the shelf included. The shell never unmounts, so neither does the context.
 *
 * Nested contexts (SortableList) keep their own drags: a draggable belongs to
 * its nearest DndContext, so reordering a list and carrying an item never see
 * each other.
 *
 * Drop targets register what they accept. `accepts` answers every question a
 * target is asked, whether a drag is hovering it or the shelf is working out
 * which of its items this page can use.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dashframe/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { ShelfItemRef } from "./shelf-store";

/** Where a drag started: a chip on the shelf, or an item on the page. */
export type DragOrigin = "shelf" | "source";

/** A target's answer: take it (and say what will happen), or say why not. */
export type DropVerdict =
  | { ok: true; label: string }
  | { ok: false; reason: string };

/**
 * `shelf` targets keep items; `page` targets use them. Only page targets
 * decide which shelf items the current page can use.
 */
export type DropTargetRole = "shelf" | "page";

export interface DropTargetSpec {
  /** Unique among mounted targets. */
  id: string;
  role: DropTargetRole;
  /** Pure and cheap: called on every render of the shelf and during drags. */
  accepts: (item: ShelfItemRef, from: DragOrigin) => DropVerdict;
  /** Called only after `accepts` said yes for the same item. */
  onDrop: (item: ShelfItemRef, from: DragOrigin) => void;
}

export interface ActiveDrag {
  item: ShelfItemRef;
  from: DragOrigin;
}

interface DragPayload {
  dashframeDrag: ActiveDrag;
}

interface TargetPayload {
  dashframeTarget: Pick<DropTargetSpec, "accepts" | "onDrop">;
}

export interface RegisteredDropTarget {
  id: string;
  role: DropTargetRole;
  accepts: DropTargetSpec["accepts"];
  /** The hook instance that registered it; two owners of one id is a bug. */
  owner?: string;
}

interface TargetRegistry {
  register: (target: RegisteredDropTarget) => void;
  unregister: (id: string, owner: string) => void;
}

const ActiveDragContext = createContext<ActiveDrag | null>(null);
const TargetRegistryContext = createContext<TargetRegistry | null>(null);
const RegisteredTargetsContext = createContext<readonly RegisteredDropTarget[]>(
  [],
);

export function useActiveDrag(): ActiveDrag | null {
  return useContext(ActiveDragContext);
}

/** Every drop target mounted right now, in mount order. */
export function useRegisteredDropTargets(): readonly RegisteredDropTarget[] {
  return useContext(RegisteredTargetsContext);
}

/**
 * Whether anything on screen can use a shelf item. Until a page target is
 * mounted, a carry from the shelf has nowhere to land (the shelf refuses its
 * own items), so shelf chips offer no drag.
 */
export function useHasPageTargets(): boolean {
  return useRegisteredDropTargets().some((target) => target.role === "page");
}

function readDrag(data: unknown): ActiveDrag | null {
  return (data as Partial<DragPayload> | undefined)?.dashframeDrag ?? null;
}

function readTarget(data: unknown): TargetPayload["dashframeTarget"] | null {
  return (data as Partial<TargetPayload> | undefined)?.dashframeTarget ?? null;
}

/** What a drag ending over `overData` should do, if anything. */
export type DropResolution =
  | { kind: "drop"; drag: ActiveDrag; verdict: { ok: true; label: string } }
  | { kind: "refused"; drag: ActiveDrag; reason: string }
  | { kind: "none" };

/**
 * Decides a drop from the drag's and the target's data: nothing carried or no
 * target under the pointer is no drop, and a target that says no refuses.
 */
export function resolveDrop(
  activeData: unknown,
  overData: unknown,
): DropResolution {
  const drag = readDrag(activeData);
  const target = readTarget(overData);
  if (!drag || !target) return { kind: "none" };
  const verdict = target.accepts(drag.item, drag.from);
  return verdict.ok
    ? { kind: "drop", drag, verdict }
    : { kind: "refused", drag, reason: verdict.reason };
}

function withTarget(
  current: readonly RegisteredDropTarget[],
  target: RegisteredDropTarget,
): readonly RegisteredDropTarget[] {
  const index = current.findIndex((entry) => entry.id === target.id);
  if (index === -1) return [...current, target];
  const existing = current[index]!;
  if (import.meta.env.DEV && existing.owner !== target.owner) {
    console.warn(
      `[shelf] Two drop targets share the id "${target.id}"; the later one replaces the earlier.`,
    );
  }
  // Same answer as before: keep the list, so the shelf does not re-render.
  if (
    existing.accepts === target.accepts &&
    existing.role === target.role &&
    existing.owner === target.owner
  ) {
    return current;
  }
  const next = [...current];
  next[index] = target;
  return next;
}

function withoutTarget(
  current: readonly RegisteredDropTarget[],
  id: string,
  owner: string,
): readonly RegisteredDropTarget[] {
  // Only the registering hook takes its target away, so a replaced target's
  // late cleanup cannot remove its replacement.
  return current.some((entry) => entry.id === id && entry.owner === owner)
    ? current.filter((entry) => !(entry.id === id && entry.owner === owner))
    : current;
}

/** Says what is being carried and where it would land, by name. */
const announcements: Announcements = {
  onDragStart: ({ active }) => {
    const drag = readDrag(active.data.current);
    return drag ? `Picked up ${drag.item.label}.` : undefined;
  },
  onDragOver: ({ active, over }) => {
    const result = resolveDrop(active.data.current, over?.data.current);
    if (result.kind === "drop") return `${result.verdict.label}.`;
    if (result.kind === "refused") return `${result.reason}.`;
    return undefined;
  },
  onDragEnd: ({ active, over }) => {
    const result = resolveDrop(active.data.current, over?.data.current);
    if (result.kind === "drop") {
      return `${result.drag.item.label}: ${result.verdict.label.toLowerCase()}, done.`;
    }
    const drag = readDrag(active.data.current);
    return drag ? `${drag.item.label} was not dropped.` : undefined;
  },
  onDragCancel: ({ active }) => {
    const drag = readDrag(active.data.current);
    return drag ? `Stopped carrying ${drag.item.label}.` : undefined;
  },
};

const screenReaderInstructions = {
  draggable:
    "Drag with a pointer to carry this item. Its buttons put it on the shelf, pin it, or take it off.",
};

export function AppDragProvider({
  children,
  overlay,
}: {
  children: ReactNode;
  /** What follows the pointer while an item is carried. */
  overlay: (drag: ActiveDrag) => ReactNode;
}) {
  // Past 4px it is a drag; short of it, a click (a chip's ×, a menu item).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [targets, setTargets] = useState<readonly RegisteredDropTarget[]>([]);

  const registry = useMemo<TargetRegistry>(
    () => ({
      register: (target) =>
        setTargets((current) => withTarget(current, target)),
      unregister: (id, owner) =>
        setTargets((current) => withoutTarget(current, id, owner)),
    }),
    [],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActive(readDrag(event.active.data.current));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActive(null);
    const result = resolveDrop(
      event.active.data.current,
      event.over?.data.current,
    );
    if (result.kind !== "drop") return;
    readTarget(event.over?.data.current)?.onDrop(
      result.drag.item,
      result.drag.from,
    );
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <TargetRegistryContext.Provider value={registry}>
        <RegisteredTargetsContext.Provider value={targets}>
          <ActiveDragContext.Provider value={active}>
            {children}
          </ActiveDragContext.Provider>
        </RegisteredTargetsContext.Provider>
      </TargetRegistryContext.Provider>
      <DragOverlay dropAnimation={null}>
        {active ? overlay(active) : null}
      </DragOverlay>
    </DndContext>
  );
}

const CONTROLS = "button, a, input, select, textarea";

/**
 * Makes an element carry `item`. Spread `handleProps` on it. The element is
 * reached by pointer only: its buttons (or the element itself, when it is a
 * button) are the keyboard path, so it takes no role or tab stop of its own.
 * A press on a control inside the element stays a click and never starts a
 * carry, however much the pointer wobbles.
 */
export function useCarryable(
  item: ShelfItemRef,
  from: DragOrigin,
  { disabled = false }: { disabled?: boolean } = {},
) {
  // The same item can show in two places at once (a tile and its chart tab).
  const instance = useId();
  const data: DragPayload = { dashframeDrag: { item, from } };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `${from}:${item.kind}:${item.id}:${instance}`,
    data,
    disabled,
  });
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const control = (event.target as Element).closest(CONTROLS);
    if (control && control !== event.currentTarget) return;
    listeners?.onPointerDown?.(event);
  };
  return {
    isDragging,
    handleProps: { ref: setNodeRef, onPointerDown },
  };
}

/**
 * Makes an element a drop target and registers it for as long as it is
 * mounted. Keep `accepts` stable (`useCallback`): a new function re-registers
 * the target. `verdict` is null while nothing is being carried, so a target
 * changes its look only during a drag.
 */
export function useDropTarget(spec: DropTargetSpec) {
  const { id, role, accepts, onDrop } = spec;
  const registry = useContext(TargetRegistryContext);
  const active = useActiveDrag();
  const owner = useId();

  useEffect(() => {
    registry?.register({ id, role, accepts, owner });
  }, [registry, id, role, accepts, owner]);
  useEffect(() => () => registry?.unregister(id, owner), [registry, id, owner]);

  const data: TargetPayload = { dashframeTarget: { accepts, onDrop } };
  const { setNodeRef, isOver } = useDroppable({ id: `target:${id}`, data });
  const verdict = active ? accepts(active.item, active.from) : null;
  return { setNodeRef, isOver, verdict, active };
}
