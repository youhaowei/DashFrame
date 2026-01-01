/**
 * Shared CVA variant tokens for consistent styling across components.
 *
 * @example
 * import { colorVariants, type ColorVariant } from "../lib/variants";
 *
 * const myVariants = cva("base", {
 *   variants: {
 *     color: colorVariants,
 *   },
 * });
 */

/** Semantic color variants for text/icon coloring */
export const colorVariants = {
  current: "text-current",
  primary: "text-primary",
  secondary: "text-muted-foreground",
  warn: "text-warn",
  danger: "text-danger",
  success: "text-success",
} as const;

/** Standard 3-level size scale (sm/md/lg) */
export const sizeScale = ["sm", "md", "lg"] as const;

export type ColorVariant = keyof typeof colorVariants;
export type SizeVariant = (typeof sizeScale)[number];
