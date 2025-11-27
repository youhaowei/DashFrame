"use client";

import * as React from "react";
import { cn } from "../lib/utils";

export type JoinType = "inner" | "left" | "right" | "outer";

export interface JoinTypeIconProps {
  /**
   * The type of join to display
   */
  type: JoinType;
  /**
   * Size variant for the icon
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * Additional CSS classes
   */
  className?: string;
}

const sizes = {
  sm: 16,
  md: 24,
  lg: 32,
};

/**
 * JoinTypeIcon - Venn diagram-style icons representing SQL join types
 *
 * Renders overlapping circles where filled regions indicate which rows are included:
 * - Inner: Only the intersection (matching rows from both tables)
 * - Left: Left circle + intersection (all left rows, matching right)
 * - Right: Intersection + right circle (matching left, all right rows)
 * - Outer: Both circles filled (all rows from both tables)
 *
 * @example
 * ```tsx
 * <JoinTypeIcon type="inner" size="md" />
 * <JoinTypeIcon type="left" size="sm" className="text-primary" />
 * ```
 */
export function JoinTypeIcon({
  type,
  size = "md",
  className,
}: JoinTypeIconProps) {
  const d = sizes[size];

  // Circle configurations
  // Left circle center: 8, Right circle center: 16, both with radius 6
  // This creates overlap in the middle region (roughly x=10 to x=14)
  const leftCenter = 8;
  const rightCenter = 16;
  const radius = 6;

  // Determine fill states based on join type
  const leftFilled = type === "left" || type === "outer";
  const rightFilled = type === "right" || type === "outer";
  // Intersection is always filled (it's the point of a join)
  const intersectionFilled = true;

  // Colors
  const strokeColor = "currentColor";
  const fillColor = "currentColor";
  const emptyFill = "transparent";

  // Unique ID for clip paths (needed for proper intersection rendering)
  const clipId = React.useId();

  return (
    <svg
      width={d}
      height={d}
      viewBox="0 0 24 24"
      className={cn("shrink-0", className)}
      aria-label={`${type} join`}
    >
      <defs>
        {/* Clip path for left circle - used to render intersection */}
        <clipPath id={`${clipId}-left`}>
          <circle cx={leftCenter} cy={12} r={radius} />
        </clipPath>
        {/* Clip path for right circle - used to render intersection */}
        <clipPath id={`${clipId}-right`}>
          <circle cx={rightCenter} cy={12} r={radius} />
        </clipPath>
      </defs>

      {/* Left circle (excluding intersection) */}
      <circle
        cx={leftCenter}
        cy={12}
        r={radius}
        fill={leftFilled ? fillColor : emptyFill}
        stroke={strokeColor}
        strokeWidth={1.5}
        opacity={leftFilled ? 0.3 : 1}
      />

      {/* Right circle (excluding intersection) */}
      <circle
        cx={rightCenter}
        cy={12}
        r={radius}
        fill={rightFilled ? fillColor : emptyFill}
        stroke={strokeColor}
        strokeWidth={1.5}
        opacity={rightFilled ? 0.3 : 1}
      />

      {/* Intersection region - rendered by drawing right circle clipped to left circle */}
      {intersectionFilled && (
        <circle
          cx={rightCenter}
          cy={12}
          r={radius}
          fill={fillColor}
          clipPath={`url(#${clipId}-left)`}
          opacity={0.6}
        />
      )}

      {/* Re-draw strokes on top for clean edges */}
      <circle
        cx={leftCenter}
        cy={12}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
      />
      <circle
        cx={rightCenter}
        cy={12}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
      />
    </svg>
  );
}

/**
 * Get a human-readable label for a join type
 */
export function getJoinTypeLabel(type: JoinType): string {
  switch (type) {
    case "inner":
      return "Inner join";
    case "left":
      return "Left join";
    case "right":
      return "Right join";
    case "outer":
      return "Outer join";
  }
}

/**
 * Get a description of what a join type does
 */
export function getJoinTypeDescription(type: JoinType): string {
  switch (type) {
    case "inner":
      return "Only matching rows from both tables";
    case "left":
      return "All rows from base, matching from joined";
    case "right":
      return "Matching from base, all from joined";
    case "outer":
      return "All rows from both tables";
  }
}
