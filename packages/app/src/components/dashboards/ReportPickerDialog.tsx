import { queryStatus } from "@/data/query-status";
import { api } from "@dashframe/convex-backend/api";
import type { Dashboard } from "@dashframe/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ItemCard,
} from "@wystack/ui-react";
import { DashboardIcon, PlusIcon } from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery } from "convex/react";
import { useMemo } from "react";

/** Where a chart goes: a report that exists, or a new one. */
export type ReportTarget =
  | { kind: "existing"; reportId: string }
  | { kind: "new" };

const RECENT_REPORT_LIMIT = 8;

/** The reports most recently worked on, newest first. */
export function recentReports<
  T extends Pick<Dashboard, "createdAt" | "updatedAt">,
>(reports: readonly T[], limit = RECENT_REPORT_LIMIT): T[] {
  return [...reports]
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .slice(0, limit);
}

function chartCountLabel(report: Pick<Dashboard, "items">) {
  const count = report.items.filter(
    (item) => item.type === "visualization",
  ).length;
  return `${count} chart${count === 1 ? "" : "s"}`;
}

interface ReportPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** What the pick is for, e.g. "Chart revenue". */
  title: string;
  description?: string;
  /** Disables the choices while the pick is being carried out. */
  busy?: boolean;
  onPick: (target: ReportTarget) => void;
}

/**
 * Asks which report a chart belongs on: one of the recent reports, or a new
 * one. A chart is always edited inside a report, so every way into a chart
 * that does not start from one goes through here.
 */
export function ReportPickerDialog({
  isOpen,
  onClose,
  title,
  description = "Charts live on reports. Pick one, or start a new report.",
  busy = false,
  onPick,
}: ReportPickerDialogProps) {
  const {
    data: reports = [],
    isLoading,
    isError,
  } = queryStatus(useQuery({ query: api.app.listDashboards, args: {} }));
  const recent = useMemo(() => recentReports(reports), [reports]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <Button
            variant="outline"
            label="New report"
            disabled={busy}
            onClick={() => onPick({ kind: "new" })}
            icon={PlusIcon}
            className="justify-start border-dashed"
          />
          {isLoading && (
            <p className="px-1 text-sm text-neutral-fg-subtle">
              Loading reports...
            </p>
          )}
          {isError && (
            <p role="alert" className="px-1 text-sm text-neutral-fg-subtle">
              Couldn't load your reports. You can still start a new one.
            </p>
          )}
          {!isLoading && !isError && recent.length > 0 && (
            <section aria-label="Recent reports" className="space-y-2">
              <h3 className="px-1 text-xs font-medium text-neutral-fg-subtle">
                Recent reports
              </h3>
              {recent.map((report) => (
                <ItemCard
                  key={report.id}
                  icon={<DashboardIcon className="h-4 w-4" />}
                  title={report.name || "Untitled report"}
                  subtitle={chartCountLabel(report)}
                  disabled={busy}
                  onClick={() =>
                    onPick({ kind: "existing", reportId: report.id })
                  }
                />
              ))}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
