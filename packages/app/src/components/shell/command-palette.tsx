import { queryStatus } from "@/data/query-status";
import { usePlatform } from "@/lib/platform";
import { api } from "@dashframe/convex-backend/api";
import { cmd, type UUID } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@wystack/ui-react";
import {
  ArrowRightIcon,
  CalculatorIcon,
  ChartIcon,
  DatabaseIcon,
  FileIcon,
  GridIcon,
  PlusIcon,
  TableIcon,
} from "@wystack/ui-react/icons";
import { useMutation, useQuery_experimental as useQuery } from "convex/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  type CommandPaletteScope,
  isCommandPaletteShortcut,
  useCommandPalette,
} from "./command-palette-store";
import {
  buildPaletteResults,
  type PaletteItem,
  type PaletteTarget,
} from "./command-palette-results";

const ICON_CLASS = "text-neutral-fg-subtle";

function ItemIcon({ item }: { item: PaletteItem }) {
  switch (item.kind) {
    case "report":
      return <GridIcon className={ICON_CLASS} aria-hidden />;
    case "chart":
      return <ChartIcon className={ICON_CLASS} aria-hidden />;
    case "data-source":
      return <DatabaseIcon className={ICON_CLASS} aria-hidden />;
    case "table":
      return <TableIcon className={ICON_CLASS} aria-hidden />;
    case "metric":
      return <CalculatorIcon className={ICON_CLASS} aria-hidden />;
    case "draft":
      return <FileIcon className={ICON_CLASS} aria-hidden />;
    case "action":
      return item.target.kind === "action" &&
        item.target.action.startsWith("go-") ? (
        <ArrowRightIcon className={ICON_CLASS} aria-hidden />
      ) : (
        <PlusIcon className={ICON_CLASS} aria-hidden />
      );
  }
}

/**
 * The app-wide command palette: search reports, charts on a report, data
 * sources and tables, saved metrics and drafts, or run an action. Mounted
 * once in the shell; ⌘K (Ctrl+K off macOS) toggles it from anywhere.
 */
export function CommandPalette({ scope }: { scope?: CommandPaletteScope }) {
  const open = useCommandPalette((state) => state.open);
  const setOpen = useCommandPalette((state) => state.setOpen);
  const toggle = useCommandPalette((state) => state.toggle);
  const { isMacOS } = usePlatform();
  const navigate = useNavigate();
  const commitBatch = useMutation(api.app.commitBatch);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!isCommandPaletteShortcut(event, isMacOS)) return;
      // Browsers bind ⌘K / Ctrl+K to their own search.
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMacOS, toggle]);

  const run = useCallback(
    async (target: PaletteTarget) => {
      setOpen(false);
      switch (target.kind) {
        case "report":
          await navigate({ to: `/dashboards/${target.reportId}` } as never);
          return;
        case "chart":
          // The chart is on this report already, so opening its tab only navigates.
          await navigate({
            to: `/dashboards/${target.reportId}`,
            search: { chart: target.chartId },
          } as never);
          return;
        case "data-source":
          await navigate({
            to: `/data-sources/${target.sourceId}`,
            search: { table: target.tableId },
          } as never);
          return;
        case "draft":
          await navigate({ to: `/drafts/${target.draftId}` } as never);
          return;
        case "action":
          switch (target.action) {
            case "new-report": {
              const id = crypto.randomUUID() as UUID;
              try {
                await commitBatch({
                  commands: [
                    cmd("CreateDashboard", { id, name: "Untitled report" }),
                  ],
                });
              } catch {
                toast.error("Couldn't create a report. Please try again.");
                return;
              }
              await navigate({ to: `/dashboards/${id}` } as never);
              return;
            }
            case "add-data-source":
              // The dialog belongs to the Data sources page, where a new
              // source appears when it is done.
              await navigate({
                to: "/data-sources",
                search: { addSource: true },
              } as never);
              return;
            case "go-reports":
              await navigate({ to: "/dashboards" } as never);
              return;
            case "go-data-sources":
              await navigate({ to: "/data-sources" } as never);
              return;
            case "go-drafts":
              await navigate({ to: "/drafts" } as never);
          }
      }
    },
    [commitBatch, navigate, setOpen],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search reports, charts, data sources, tables, saved metrics and drafts, or run an action."
      // The workbench scope (#503) renders here as a removable chip.
      leading={scope ? <span>{scope.label}</span> : undefined}
      footer={<KeyHints />}
      className="duration-150"
    >
      <PaletteBody onRun={run} onClose={() => setOpen(false)} />
    </CommandDialog>
  );
}

/**
 * The search and its results. Rendered inside the dialog, so the query starts
 * empty on every open. The lists are the ones the shell already subscribes to
 * (see WebMCPProvider); the same query and arguments share one subscription.
 * A list that fails, such as one over the 1000-row cap, drops out and the
 * others still show.
 */
function PaletteBody({
  onRun,
  onClose,
}: {
  onRun: (target: PaletteTarget) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const { isMacOS } = usePlatform();
  const reports = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  ).data;
  const charts = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  ).data;
  const dataSources = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  ).data;
  const dataTables = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  ).data;
  const drafts = queryStatus(
    useQuery({ query: api.app.listDrafts, args: {} }),
  ).data;

  const groups = useMemo(
    () =>
      buildPaletteResults(
        { reports, charts, dataSources, dataTables, drafts },
        search,
      ),
    [reports, charts, dataSources, dataTables, drafts, search],
  );

  return (
    // The results arrive filtered, ranked and in their fixed group order, so
    // cmdk must not filter or re-sort them. `CommandDialog` does not forward
    // cmdk's root props, so this inner root carries `shouldFilter`; its keys
    // are handled here and never reach the dialog's own (empty) root.
    <Command
      shouldFilter={false}
      loop
      onKeyDown={(event) => {
        // cmdk's vim bindings read Ctrl+K as "move up" and consume it; close
        // first, so Ctrl+K toggles off macOS as ⌘K does on macOS.
        if (isCommandPaletteShortcut(event, isMacOS)) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className="min-h-0 flex-1 rounded-none bg-transparent"
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search or run an action…"
      />
      <CommandList>
        <CommandEmpty>No results</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.heading}>
            {group.items.map((item) => (
              <PaletteRow key={item.id} item={item} onRun={onRun} />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

function PaletteRow({
  item,
  onRun,
}: {
  item: PaletteItem;
  onRun: (target: PaletteTarget) => void;
}) {
  return (
    <CommandItem value={item.id} onSelect={() => onRun(item.target)}>
      <ItemIcon item={item} />
      <span className="min-w-0 truncate">{item.label}</span>
      {item.detail ? (
        <span className="ml-auto shrink-0 pl-4 text-xs text-neutral-fg-subtle">
          {item.detail}
        </span>
      ) : null}
    </CommandItem>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-neutral-bg-subtle px-1 font-sans text-[11px] text-neutral-fg-subtle">
      {children}
    </kbd>
  );
}

function KeyHints() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <Key>↑</Key>
        <Key>↓</Key>
        move
      </span>
      <span className="flex items-center gap-1">
        <Key>↵</Key>
        open
      </span>
      <span className="flex items-center gap-1">
        <Key>esc</Key>
        close
      </span>
    </div>
  );
}
