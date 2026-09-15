import {
  ButtonPrimitive,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wystack/ui-react";
import { ChevronDownIcon } from "@wystack/ui-react/icons";
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

const LABEL_CLASS = "text-[11px] font-medium text-neutral-fg-subtle";

/**
 * One "View" menu for the width the editor lays the report out at and how far
 * it zooms. `null` means "the reader's width in this window" and "fit the
 * canvas". Sized for the workbench's canvas header.
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
  const percent = `${Math.round(scale * 100)}%`;

  return (
    <DropdownMenu>
      {/* Gives way first when both panes squeeze the header: collapsing a
          pane brings it back. */}
      <DropdownMenuTrigger
        render={
          <ButtonPrimitive
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`View: ${Math.round(width)}px at ${percent}`}
            className="h-7 shrink-0 gap-1 px-2 text-xs @max-2xl:hidden"
          >
            View
            <span className="text-neutral-fg-subtle tabular-nums">
              {percent}
            </span>
            <ChevronDownIcon aria-hidden className="size-3.5" />
          </ButtonPrimitive>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className={LABEL_CLASS}>
            Width · {Math.round(width)}px
            {width < REPORT_STACK_BELOW && ", stacked"}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={chosenWidth === null ? "window" : String(chosenWidth)}
            onValueChange={(value: string) =>
              onWidthChange(value === "window" ? null : Number(value))
            }
          >
            {WIDTHS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className={LABEL_CLASS}>Zoom</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={zoom === null ? "fit" : String(zoom)}
            onValueChange={(value: string) =>
              onZoomChange(value === "fit" ? null : Number(value))
            }
          >
            <DropdownMenuRadioItem value="fit">
              Fit to canvas
            </DropdownMenuRadioItem>
            {ZOOMS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
