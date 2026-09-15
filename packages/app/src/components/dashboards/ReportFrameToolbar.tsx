import { Toggle } from "@wystack/ui-react";
import { REPORT_STACK_BELOW } from "./DashboardGrid";

const WIDTHS = [
  { value: "window", label: "This window" },
  { value: "1280", label: "Laptop" },
  { value: "1440", label: "Desktop" },
  { value: "1920", label: "Wide" },
  { value: "768", label: "Tablet" },
  { value: "390", label: "Phone" },
];

const ZOOMS = [
  { value: "fit", label: "Fit" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
];

/**
 * Picks the width the editor lays the report out at, and how far it zooms.
 * `null` means "the reader's width in this window" and "fit the canvas".
 */
export function ReportFrameToolbar({
  width,
  scale,
  chosenWidth,
  zoom,
  onWidthChange,
  onZoomChange,
}: {
  width: number;
  scale: number;
  chosenWidth: number | null;
  zoom: number | null;
  onWidthChange: (width: number | null) => void;
  onZoomChange: (zoom: number | null) => void;
}) {
  const layout =
    width < REPORT_STACK_BELOW
      ? "stacked, follows the desktop layout"
      : "12 columns";

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 pt-3">
      <Toggle
        size="sm"
        value={chosenWidth === null ? "window" : String(chosenWidth)}
        options={WIDTHS}
        onValueChange={(value) =>
          onWidthChange(value === "window" ? null : Number(value))
        }
      />
      <Toggle
        size="sm"
        value={zoom === null ? "fit" : String(zoom)}
        options={ZOOMS}
        onValueChange={(value) =>
          onZoomChange(value === "fit" ? null : Number(value))
        }
      />
      <span
        className="text-xs text-neutral-fg-subtle tabular-nums"
        aria-live="polite"
      >
        {Math.round(width)}px · {layout} · {Math.round(scale * 100)}%
      </span>
    </div>
  );
}
