import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { REPORT_STACK_BELOW } from "./DashboardGrid";

const WIDTHS = [
  { value: "window", label: "This window" },
  { value: "1280", label: "Laptop · 1280" },
  { value: "1440", label: "Desktop · 1440" },
  { value: "1920", label: "Wide · 1920" },
  { value: "768", label: "Tablet · 768" },
  { value: "390", label: "Phone · 390" },
];

const ZOOMS = [
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
];

const TRIGGER_CLASS = "h-7 w-auto gap-1.5 px-2 text-xs";

/**
 * Picks the width the editor lays the report out at, and how far it zooms.
 * `null` means "the reader's width in this window" and "fit the canvas".
 * Sized for the workbench's canvas header.
 */
export function ReportFrameControls({
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
  const zooms = [
    { value: "fit", label: `Fit · ${Math.round(scale * 100)}%` },
    ...ZOOMS,
  ];

  return (
    // Gives way first when both panes squeeze the header: collapsing a pane
    // brings it back.
    <div className="flex shrink-0 items-center gap-1 @max-2xl:hidden">
      <Select
        items={WIDTHS}
        value={chosenWidth === null ? "window" : String(chosenWidth)}
        onValueChange={(value) =>
          onWidthChange(!value || value === "window" ? null : Number(value))
        }
      >
        <SelectTrigger
          size="sm"
          variant="ghost"
          aria-label="Report width"
          className={TRIGGER_CLASS}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WIDTHS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={zooms}
        value={zoom === null ? "fit" : String(zoom)}
        onValueChange={(value) =>
          onZoomChange(!value || value === "fit" ? null : Number(value))
        }
      >
        <SelectTrigger
          size="sm"
          variant="ghost"
          aria-label="Zoom"
          className={TRIGGER_CLASS}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {zooms.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span
        className="px-1 text-xs text-neutral-fg-subtle tabular-nums @max-5xl:hidden"
        aria-live="polite"
      >
        {Math.round(width)}px
        {width < REPORT_STACK_BELOW && " · stacked"}
      </span>
    </div>
  );
}
