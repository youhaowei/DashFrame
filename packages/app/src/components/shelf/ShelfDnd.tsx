/**
 * SPIKE: one drag context for the whole app, mounted above the router's
 * outlet so a drag started on any page can land on any other page's target.
 * Nested DndContexts (SortableList) keep their own drags; a draggable belongs
 * to its nearest context, so shelf drags and sortable drags never mix.
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
  useState,
  type ReactNode,
} from "react";
import { ShelfChipView } from "./ShelfChipView";
import type { ShelfItem } from "./shelf-store";

export type ShelfDragOrigin = "shelf" | "source";

interface ShelfDragData {
  shelfDrag: { item: ShelfItem; from: ShelfDragOrigin };
}

/** `true` accepts; a string refuses and says why. */
export type ShelfVerdict = true | string;

interface ShelfDropData {
  shelfTarget: {
    accepts: (item: ShelfItem, from: ShelfDragOrigin) => ShelfVerdict;
    onDrop: (item: ShelfItem, from: ShelfDragOrigin) => void;
  };
}

interface ActiveDrag {
  item: ShelfItem;
  from: ShelfDragOrigin;
}

const ActiveDragContext = createContext<ActiveDrag | null>(null);

export function useActiveShelfDrag(): ActiveDrag | null {
  return useContext(ActiveDragContext);
}

function readDrag(data: unknown): ActiveDrag | null {
  const drag = (data as Partial<ShelfDragData> | undefined)?.shelfDrag;
  return drag ?? null;
}

export function ShelfDndProvider({ children }: { children: ReactNode }) {
  // A click (the chip's ×, a menu item) must not start a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [active, setActive] = useState<ActiveDrag | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActive(readDrag(event.active.data.current));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const drag = readDrag(event.active.data.current);
    setActive(null);
    const target = (event.over?.data.current as Partial<ShelfDropData>)
      ?.shelfTarget;
    if (!drag || !target) return;
    if (target.accepts(drag.item, drag.from) !== true) return;
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
      <ActiveDragContext.Provider value={active}>
        {children}
      </ActiveDragContext.Provider>
      <DragOverlay dropAnimation={null}>
        {active ? <ShelfChipView item={active.item} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}

export function useShelfDraggable(
  id: string,
  item: ShelfItem,
  from: ShelfDragOrigin,
) {
  const data: ShelfDragData = { shelfDrag: { item, from } };
  return useDraggable({ id: `${from}:${id}`, data });
}

/**
 * A place a shelf item can land. `verdict` is null while nothing is being
 * dragged, so a target only changes its look during a drag.
 */
export function useShelfDropTarget(
  id: string,
  accepts: ShelfDropData["shelfTarget"]["accepts"],
  onDrop: ShelfDropData["shelfTarget"]["onDrop"],
) {
  const active = useActiveShelfDrag();
  const data: ShelfDropData = { shelfTarget: { accepts, onDrop } };
  const { setNodeRef, isOver } = useDroppable({ id, data });
  const verdict = active ? accepts(active.item, active.from) : null;
  return { setNodeRef, isOver, verdict };
}
