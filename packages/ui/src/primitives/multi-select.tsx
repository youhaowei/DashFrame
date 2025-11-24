"use client";

import * as React from "react";
import type { ColumnType } from "@dashframe/dataframe";
import {
  ChevronDown,
  X,
  Type,
  Hash,
  Calendar,
  Toggle,
  Dot,
} from "../lib/icons";
import { cn } from "../lib/utils";
import { Badge } from "./badge";
import { Checkbox } from "./checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

type MultiSelectColumnType = ColumnType | "object" | "array";

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
  type?: MultiSelectColumnType;
}

function getTypeIcon(type?: MultiSelectColumnType) {
  switch (type) {
    case "string":
      return Type;
    case "number":
      return Hash;
    case "date":
      return Calendar;
    case "boolean":
      return Toggle;
    case "object":
    case "array":
    default:
      return Dot;
  }
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxLines?: number;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select items...",
  disabled = false,
  className,
  maxLines = 3,
}: MultiSelectProps) {
  const selectedOptions = options.filter((opt) => value.includes(opt.value));
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hiddenCount, setHiddenCount] = React.useState(0);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || selectedOptions.length === 0) {
      setHiddenCount(0);
      return;
    }

    // Measure overflow by comparing scroll height to client height
    const checkOverflow = () => {
      const isOverflowing = container.scrollHeight > container.clientHeight;

      if (isOverflowing) {
        // Count how many badges are hidden by measuring their positions
        const badges = Array.from(container.children) as HTMLElement[];
        const containerBottom = container.clientHeight;

        let hidden = 0;
        badges.forEach((badge) => {
          const rect = badge.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const relativeBottom = rect.bottom - containerRect.top;

          if (relativeBottom > containerBottom) {
            hidden++;
          }
        });

        setHiddenCount(hidden);
      } else {
        setHiddenCount(0);
      }
    };

    checkOverflow();

    // Re-check on window resize
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [selectedOptions]);

  const handleToggle = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const handleRemove = (e: React.MouseEvent, optionValue: string) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== optionValue));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            // Base styles matching SelectTrigger
            "border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 shadow-xs",
            "flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-[color,box-shadow]",
            "focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
            // Multi-select specific: allow wrapping for tags
            "h-auto min-h-9",
            !value.length && "text-muted-foreground",
            className,
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
            {selectedOptions.length > 0 ? (
              <>
                <div
                  ref={containerRef}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden"
                  style={{
                    maxHeight: `calc(${maxLines} * 1.5rem + ${maxLines - 1} * 0.375rem)`
                  }}
                >
                  {selectedOptions.map((opt) => {
                    const TypeIcon = getTypeIcon(opt.type);
                    return (
                      <Badge
                        key={opt.value}
                        variant="secondary"
                        className="max-w-[200px] gap-1 px-2 py-0.5 text-xs font-normal"
                      >
                        {opt.type && (
                          <TypeIcon className="text-muted-foreground h-3 w-3 shrink-0" />
                        )}
                        <span className="truncate">{opt.label}</span>
                        <X
                          className="h-3 w-3 shrink-0 cursor-pointer hover:text-foreground"
                          onClick={(e) => handleRemove(e, opt.value)}
                        />
                      </Badge>
                    );
                  })}
                </div>
                {hiddenCount > 0 && (
                  <span className="text-muted-foreground shrink-0 text-sm">
                    +{hiddenCount} more
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground text-sm">
                {placeholder}
              </span>
            )}
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--radix-dropdown-menu-trigger-width) max-h-80 overflow-y-auto"
        align="start"
      >
        {options.map((option) => {
          const isSelected = value.includes(option.value);
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={(e) => {
                e.preventDefault();
                handleToggle(option.value);
              }}
              className={cn(
                "flex items-start gap-2.5 cursor-pointer",
                option.description && "py-2.5"
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => handleToggle(option.value)}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm leading-tight">
                  {option.label}
                </span>
                {option.description && (
                  <span className="text-muted-foreground truncate font-mono text-[11px] leading-tight">
                    {option.description}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
