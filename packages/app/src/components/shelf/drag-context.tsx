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
}

interface TargetRegistry {
  register: (target: RegisteredDropTarget) => void;
  unregister: (id: string) => void;
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

function readDrag(data: unknown): ActiveDrag | null {
  return (data as Partial<DragPayload> | undefined)?.dashframeDrag ?? null;
}

function readTarget(data: unknown): TargetPayload["dashframeTarget"] | null {
  return (data as Partial<TargetPayload> | undefined)?.dashframeTarget ?? null;
}

function withTarget(
  current: readonly RegisteredDropTarget[],
  target: RegisteredDropTarget,
): readonly RegisteredDropTarget[] {
  const index = current.findIndex((entry) => entry.id === target.id);
  if (index === -1) return [...current, target];
  const existing = current[index]!;
  // Same answer as before: keep the list, so the shelf does not re-render.
  if (existing.accepts === target.accepts && existing.role === target.role) {
    return current;
  }
  const next = [...current];
  next[index] = target;
  return next;
}

function withoutTarget(
  current: readonly RegisteredDropTarget[],
  id: string,
): readonly RegisteredDropTarget[] {
  return current.some((entry) => entry.id === id)
    ? current.filter((entry) => entry.id !== id)
    : current;
}

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
      unregister: (id) => setTargets((current) => withoutTarget(current, id)),
    }),
    [],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActive(readDrag(event.active.data.current));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const drag = readDrag(event.active.data.current);
    setActive(null);
    const target = readTarget(event.over?.data.current);
    if (!drag || !target) return;
    if (!target.accepts(drag.item, drag.from).ok) return;
    target.onDrop(drag.item, drag.from);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
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

/**
 * Makes an element carry `item`. Spread `attributes` and `listeners` on it and
 * give it `setNodeRef`.
 */
export function useCarryable(
  item: ShelfItemRef,
  from: DragOrigin,
  { disabled = false }: { disabled?: boolean } = {},
) {
  // The same item can show in two places at once (a tile and its chart tab).
  const instance = useId();
  const data: DragPayload = { dashframeDrag: { item, from } };
  return useDraggable({
    id: `${from}:${item.kind}:${item.id}:${instance}`,
    data,
    disabled,
  });
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

  useEffect(() => {
    registry?.register({ id, role, accepts });
  }, [registry, id, role, accepts]);
  useEffect(() => () => registry?.unregister(id), [registry, id]);

  const data: TargetPayload = { dashframeTarget: { accepts, onDrop } };
  const { setNodeRef, isOver } = useDroppable({ id: `target:${id}`, data });
  const verdict = active ? accepts(active.item, active.from) : null;
  return { setNodeRef, isOver, verdict, active };
}
