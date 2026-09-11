import {
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Switch,
  Tooltip,
  cn,
} from "@wystack/ui-react";
import {
  ChevronDownIcon,
  ChevronsUpIcon,
  CloseIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import type { LucideIcon } from "@wystack/ui-react/icons";
import {
  type ComponentProps,
  forwardRef,
  useCallback,
  useRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

export function useWorkbenchPaneSections<const T extends string>(
  ids: readonly T[],
  defaultOpen = true,
) {
  const [openSections, setOpenSections] = useState<Record<T, boolean>>(
    () =>
      Object.fromEntries(ids.map((id) => [id, defaultOpen])) as Record<
        T,
        boolean
      >,
  );
  const sectionRefs = useRef<Partial<Record<T, HTMLDivElement | null>>>({});
  const allCollapsed = ids.every((id) => !openSections[id]);
  const setSectionOpen = useCallback((id: T, open: boolean) => {
    setOpenSections((current) => ({ ...current, [id]: open }));
  }, []);
  const jumpToSection = useCallback((id: T) => {
    setOpenSections((current) => ({ ...current, [id]: true }));
    requestAnimationFrame(() =>
      sectionRefs.current[id]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      }),
    );
  }, []);
  const toggleAll = useCallback(() => {
    setOpenSections((current) => {
      const shouldOpen = ids.every((id) => !current[id]);
      return Object.fromEntries(ids.map((id) => [id, shouldOpen])) as Record<
        T,
        boolean
      >;
    });
  }, [ids]);
  const registerSection = useCallback(
    (id: T) => (node: HTMLDivElement | null) => {
      sectionRefs.current[id] = node;
    },
    [],
  );
  return {
    openSections,
    allCollapsed,
    setSectionOpen,
    jumpToSection,
    toggleAll,
    registerSection,
  };
}

export interface WorkbenchPaneSectionProps {
  title: string;
  icon: LucideIcon;
  open: boolean;
  summary: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export const WorkbenchPaneSection = forwardRef<
  HTMLDivElement,
  WorkbenchPaneSectionProps
>(function WorkbenchPaneSection(
  { title, icon: Icon, open, summary, onOpenChange, children },
  ref,
) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      {/* scroll-mt keeps a jumped-to section clear of the sticky pane header. */}
      <div
        ref={ref}
        className="scroll-mt-20 border-t border-neutral-border/60 py-1.5"
      >
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs font-medium transition-colors hover:bg-neutral-bg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
            >
              <Icon
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-neutral-fg-subtle"
              />
              <span className="shrink-0">{title}</span>
              {!open && (
                <span className="ml-auto min-w-0 truncate font-normal text-neutral-fg-subtle">
                  {summary}
                </span>
              )}
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-neutral-fg-subtle transition-transform",
                  !open && "-rotate-90",
                  open && "ml-auto",
                )}
              />
            </button>
          }
        />
        <CollapsibleContent className="pt-1 pb-1.5">
          {children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

/**
 * Pane title and jump bar. It sticks to the top of the pane's scroll area so
 * the jump bar stays reachable. The pane body must pad with px-3/py-3 (the
 * header cancels that padding to paint edge to edge) and must not set
 * overflow-x-hidden, which would make it the sticky scrollport.
 */
/**
 * Scroll area for a workbench pane. The scrollbar stays hidden; fades mark the
 * edges that have more content past them. The top fade hangs under a
 * WorkbenchPaneHeader when one is present.
 */
export function WorkbenchScrollArea({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    );
  }, []);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Content grows and shrinks as sections collapse, so watch both boxes.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    update();
    return () => observer.disconnect();
  }, [update]);
  return (
    <div className={cn("relative h-full", className)}>
      <div
        ref={scrollerRef}
        onScroll={update}
        data-scrolled={edges.top || undefined}
        className="group/pane-scroll h-full overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-linear-to-t from-neutral-bg to-transparent transition-opacity duration-150",
          edges.bottom ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

export function WorkbenchPaneHeader({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-3 -mt-3 bg-neutral-bg px-3 pt-3 pb-2">
      <h2 className="px-0.5 pb-2 text-sm font-semibold">{title}</h2>
      {children}
      {/* Marks content scrolled under the header inside a WorkbenchScrollArea. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full h-6 bg-linear-to-b from-neutral-bg to-transparent opacity-0 transition-opacity duration-150 group-data-[scrolled]/pane-scroll:opacity-100"
      />
    </div>
  );
}

export interface WorkbenchJumpItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export function WorkbenchJumpBar({
  items,
  onJump,
  allCollapsed,
  onToggleAll,
}: {
  items: readonly WorkbenchJumpItem[];
  onJump: (id: string) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}) {
  const allLabel = allCollapsed ? "Expand all" : "Collapse all";
  return (
    <nav aria-label="Workbench sections" className="flex items-center gap-0.5">
      {items.map((item) => (
        <Tooltip key={item.id} content={`Jump to ${item.label}`}>
          <Button
            size="sm"
            variant="ghost"
            icon={item.icon}
            iconOnly
            label={`Jump to ${item.label}`}
            onClick={() => onJump(item.id)}
            className="h-7 w-7"
          />
        </Tooltip>
      ))}
      <span className="flex-1" />
      <Tooltip content={allLabel}>
        <Button
          size="sm"
          variant="ghost"
          icon={ChevronsUpIcon}
          iconOnly
          label={allLabel}
          onClick={onToggleAll}
          className={cn("h-7 w-7", allCollapsed && "rotate-180")}
        />
      </Tooltip>
    </nav>
  );
}

export interface WorkbenchChipProps {
  dragHandle?: ReactNode;
  icon: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Optional complete main-content trigger, used by anchored popovers. */
  content?: ReactNode;
  trailing?: ReactNode;
  open?: boolean;
  removeLabel?: string;
  onRemove?: () => void;
  className?: string;
}

export function WorkbenchChip({
  dragHandle,
  icon,
  title,
  description,
  content,
  trailing,
  open = false,
  removeLabel,
  onRemove,
  className,
}: WorkbenchChipProps) {
  return (
    <div
      data-open={open || undefined}
      className={cn(
        "group flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg bg-neutral-bg-subtle px-1.5 py-1 text-xs transition-colors hover:bg-neutral-bg-muted data-[open]:bg-neutral-bg-emphasis focus-within:bg-neutral-bg-muted",
        className,
      )}
    >
      <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {dragHandle}
      </span>
      <span className="grid h-4 w-4 shrink-0 place-items-center text-neutral-fg-subtle">
        {icon}
      </span>
      {content ?? (
        <div className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium text-neutral-fg">
            {title}
          </span>
          {description && (
            <span className="block truncate text-[11px] leading-4 text-neutral-fg-subtle group-hover:text-neutral-fg-muted group-focus-within:text-neutral-fg-muted group-data-[open]:text-neutral-fg-muted">
              {description}
            </span>
          )}
        </div>
      )}
      {trailing}
      {removeLabel && onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-fg-subtle opacity-0 transition-opacity hover:bg-neutral-bg-emphasis hover:text-neutral-fg group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <CloseIcon aria-hidden className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export const WorkbenchAddRow = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function WorkbenchAddRow({ children, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex min-h-8 w-full items-center gap-1.5 rounded-lg border border-dashed border-neutral-border px-2 text-left text-xs text-neutral-fg-subtle transition-colors hover:bg-neutral-bg-subtle hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <PlusIcon aria-hidden className="h-3.5 w-3.5" />
      {children}
    </button>
  );
});

/**
 * Toggles in panes share the input well: sub tone and a hairline border at
 * rest, a primary fill once on. Child selectors resize the stdui thumb, which
 * takes no className of its own.
 */
export function WorkbenchSwitch({
  className,
  ...props
}: ComponentProps<typeof Switch>) {
  return (
    <Switch
      className={cn(
        "h-4 w-7 cursor-pointer border border-neutral-border p-px data-[checked]:border-palette-primary data-[unchecked]:bg-neutral-bg-subtle",
        "[&>span]:h-3 [&>span]:w-3 [&>span]:shadow-sm data-[checked]:[&>span]:translate-x-3",
        className,
      )}
      {...props}
    />
  );
}

/** Checkboxes in panes: an input well at rest, a primary fill when checked. */
export function WorkbenchCheckbox({
  className,
  ...props
}: ComponentProps<typeof Checkbox>) {
  return (
    <Checkbox
      className={cn(
        "cursor-pointer border-neutral-border bg-neutral-bg-subtle data-[checked]:border-palette-primary [&_svg]:h-3 [&_svg]:w-3",
        className,
      )}
      {...props}
    />
  );
}
