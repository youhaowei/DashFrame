import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@wystack/ui-react";
import { SearchIcon } from "@wystack/ui-react/icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { OverlayScrollArea } from "./OverlayScrollArea";

export interface WorkbenchTabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Keeps the tab at an end of the strip instead of in the scrolling middle. */
  pinned?: "start" | "end";
  /** Dashed outline: the tab makes something rather than opening something. */
  dashed?: boolean;
  /** Dot marking work that has not been saved yet. */
  unsaved?: boolean;
}

export interface WorkbenchTabsProps {
  /** Accessible name for the strip. */
  label: string;
  tabs: WorkbenchTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Label for the search control shown once the strip overflows. */
  findLabel?: string;
  findEmptyLabel?: string;
  className?: string;
}

// Slack the overflow test so a sub-pixel layout never flickers the control.
const OVERFLOW_SLACK = 8;

function TabButton({
  tab,
  active,
  onSelect,
}: {
  tab: WorkbenchTabItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-tab-id={tab.id}
      onClick={() => onSelect(tab.id)}
      title={tab.label}
      className={cn(
        "flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
        "transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
        tab.dashed && "border border-dashed border-neutral-border",
        active
          ? "bg-neutral-bg-muted text-neutral-fg"
          : "text-neutral-fg-subtle hover:bg-neutral-bg-muted/60 hover:text-neutral-fg",
      )}
    >
      {tab.icon && <span className="shrink-0">{tab.icon}</span>}
      <span className="truncate">{tab.label}</span>
      {tab.unsaved && (
        <span
          aria-label="Not saved"
          className="size-1.5 shrink-0 rounded-full bg-palette-primary"
        />
      )}
    </button>
  );
}

/**
 * Horizontal strip of canvas tabs. Tabs pinned to either end stay put while
 * the rest scroll between them, and a search control appears only once there
 * are more tabs than fit.
 */
export function WorkbenchTabs({
  label,
  tabs,
  activeId,
  onSelect,
  findLabel = "Find",
  findEmptyLabel = "No matches.",
  className,
}: WorkbenchTabsProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  const start = tabs.filter((tab) => tab.pinned === "start");
  const end = tabs.filter((tab) => tab.pinned === "end");
  const middle = tabs.filter((tab) => !tab.pinned);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setOverflowing(
      viewport.scrollWidth - viewport.clientWidth > OVERFLOW_SLACK,
    );
  }, []);

  // The strip overflows when either the pane narrows or a tab is added, so
  // watch the viewport and its content rather than re-measuring on render.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const track = viewport.firstElementChild;
    if (track) observer.observe(track);
    return () => observer.disconnect();
  }, [measure]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      viewportRef.current
        ?.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({
          inline: "nearest",
          block: "nearest",
          behavior: "smooth",
        });
    },
    [onSelect],
  );

  return (
    // One tablist spans the strip: the pinned ends and the scrolling middle
    // are all tabs for the same canvas.
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex min-w-0 items-center gap-1", className)}
    >
      {start.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          onSelect={handleSelect}
        />
      ))}
      <OverlayScrollArea
        orientation="horizontal"
        scrollbar="none"
        className="min-w-0 flex-1"
        viewportRef={viewportRef}
      >
        {/* Trailing room keeps the last tab clear of the edge fade. */}
        <div className="flex gap-1 pr-6">
          {middle.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </OverlayScrollArea>
      {overflowing && (
        <Popover open={findOpen} onOpenChange={setFindOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={findLabel}
                title={findLabel}
                className={cn(
                  "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
                  "text-neutral-fg-subtle transition-colors duration-150 motion-reduce:transition-none",
                  "hover:bg-neutral-bg-muted/60 hover:text-neutral-fg",
                  "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
                )}
              >
                <SearchIcon aria-hidden className="size-3.5" />
                <span>{findLabel}</span>
              </button>
            }
          />
          <PopoverContent align="end" className="w-64 p-0">
            <Command label={label}>
              <CommandInput placeholder={`${findLabel}…`} />
              <CommandList>
                <CommandEmpty>{findEmptyLabel}</CommandEmpty>
                {tabs.map((tab) => (
                  <CommandItem
                    key={tab.id}
                    value={tab.label}
                    onSelect={() => {
                      setFindOpen(false);
                      handleSelect(tab.id);
                    }}
                  >
                    {tab.icon && <span className="shrink-0">{tab.icon}</span>}
                    <span className="truncate">{tab.label}</span>
                    {tab.unsaved && (
                      <span className="ml-auto size-1.5 shrink-0 rounded-full bg-palette-primary" />
                    )}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
      {end.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}
