"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from "@dashframe/ui";
import { Calendar } from "@dashframe/ui/icons";
import type {
  TemporalAggregation,
  CategoricalDateGroup,
  ChannelTransform,
} from "@dashframe/types";

/**
 * Temporal aggregation options for time series charts.
 * These preserve time continuity (x-axis stays temporal).
 */
const TEMPORAL_OPTIONS: Array<{
  value: TemporalAggregation;
  label: string;
  description: string;
}> = [
  { value: "none", label: "Raw dates", description: "No aggregation" },
  { value: "yearWeek", label: "Weekly", description: "Group by week" },
  { value: "yearMonth", label: "Monthly", description: "Group by month" },
  { value: "year", label: "Yearly", description: "Group by year" },
];

/**
 * Categorical grouping options for seasonal analysis.
 * These group data across years (x-axis becomes ordinal).
 */
const CATEGORICAL_OPTIONS: Array<{
  value: CategoricalDateGroup;
  label: string;
  description: string;
}> = [
  { value: "monthName", label: "Month name", description: "Jan, Feb, ..." },
  { value: "dayOfWeek", label: "Day of week", description: "Mon, Tue, ..." },
  { value: "quarter", label: "Quarter", description: "Q1, Q2, Q3, Q4" },
];

interface DateTransformPickerProps {
  /** Current transform value (undefined means no transform) */
  value: ChannelTransform | undefined;
  /** Callback when transform changes */
  onChange: (transform: ChannelTransform | undefined) => void;
  /** Auto-suggested aggregation (shown as recommended) */
  autoSuggested?: TemporalAggregation;
  /** Compact mode - single line layout */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DateTransformPicker - UI for selecting date transform options.
 *
 * Provides two modes:
 * 1. **Time Series** (temporal aggregation): For continuous time charts
 *    - Options: Raw dates, Weekly, Monthly, Yearly
 *    - Preserves time continuity on x-axis
 *
 * 2. **Seasonal Analysis** (categorical grouping): For comparing periods
 *    - Options: Month name, Day of week, Quarter
 *    - Groups data across years
 *
 * When compact=true, shows a single select with all options.
 * When compact=false, shows separate sections for each mode.
 */
export function DateTransformPicker({
  value,
  onChange,
  autoSuggested,
  compact = true,
  className,
}: DateTransformPickerProps) {
  // Determine current selection
  const currentValue = useMemo(() => {
    if (!value) return "none";
    if (value.transform.kind === "temporal") {
      return value.transform.aggregation;
    }
    return value.transform.groupBy;
  }, [value]);

  // Computed value for the temporal select (used in full mode)
  const temporalSelectValue = useMemo(() => {
    if (value?.transform.kind === "temporal") {
      return value.transform.aggregation;
    }
    // No transform or categorical transform - show "none" if that's the current value
    return currentValue === "none" ? "none" : "";
  }, [value, currentValue]);

  // Handle selection change
  const handleChange = (newValue: string) => {
    // Check if it's a temporal aggregation
    const temporalOption = TEMPORAL_OPTIONS.find(
      (opt) => opt.value === newValue,
    );
    if (temporalOption) {
      if (newValue === "none") {
        // No transform needed
        onChange(undefined);
      } else {
        onChange({
          type: "date",
          transform: {
            kind: "temporal",
            aggregation: newValue as TemporalAggregation,
          },
        });
      }
      return;
    }

    // Check if it's a categorical grouping
    const categoricalOption = CATEGORICAL_OPTIONS.find(
      (opt) => opt.value === newValue,
    );
    if (categoricalOption) {
      onChange({
        type: "date",
        transform: {
          kind: "categorical",
          groupBy: newValue as CategoricalDateGroup,
        },
      });
    }
  };

  if (compact) {
    return (
      <div className={className}>
        <Select value={currentValue} onValueChange={handleChange}>
          <SelectTrigger className="h-8 text-xs">
            <Calendar className="text-muted-foreground mr-1.5 h-3.5 w-3.5" />
            <SelectValue placeholder="Date grouping" />
          </SelectTrigger>
          <SelectContent>
            {/* Time Series Options */}
            <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
              Time Series
            </div>
            {TEMPORAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                <span className="flex items-center gap-1.5">
                  {opt.label}
                  {autoSuggested === opt.value && (
                    <span className="text-muted-foreground text-[10px]">
                      (recommended)
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}

            {/* Seasonal Analysis Options */}
            <div className="text-muted-foreground mt-1 border-t px-2 py-1.5 text-xs font-medium">
              Seasonal Analysis
            </div>
            {CATEGORICAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Full mode with two sections
  return (
    <div className={`space-y-3 ${className || ""}`}>
      {/* Time Series Section */}
      <div className="space-y-1.5">
        <Label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Calendar className="h-3.5 w-3.5" />
          Time series granularity
        </Label>
        <Select value={temporalSelectValue} onValueChange={handleChange}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder="Select granularity" />
          </SelectTrigger>
          <SelectContent>
            {TEMPORAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5">
                    {opt.label}
                    {autoSuggested === opt.value && (
                      <span className="text-muted-foreground text-xs">
                        (recommended)
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {opt.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Seasonal Analysis Section */}
      <div className="space-y-1.5">
        <Label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Calendar className="h-3.5 w-3.5" />
          Or group by season
        </Label>
        <Select
          value={
            value?.transform.kind === "categorical"
              ? value.transform.groupBy
              : ""
          }
          onValueChange={handleChange}
        >
          <SelectTrigger className="h-8">
            <SelectValue placeholder="Select grouping" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORICAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div className="flex flex-col">
                  <span>{opt.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {opt.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
