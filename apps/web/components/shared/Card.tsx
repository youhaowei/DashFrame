import * as React from "react";

import { cn } from "@/lib/utils";
import { Surface, type SurfaceElevation } from "@/components/ui/surface";

export interface CardProps extends React.ComponentProps<"div"> {
  /**
   * The elevation variant for the card surface.
   * Controls visual depth and shadow effects.
   *
   * @default "raised"
   */
  elevation?: SurfaceElevation;
  /**
   * Adds hover interaction states for clickable cards.
   *
   * @default false
   */
  interactive?: boolean;
}

/**
 * Card - Content grouping component with standardized elevation.
 *
 * Card provides structured layout for content with header, title, description,
 * content, and footer sections. Uses Surface primitive internally for consistent
 * elevation effects.
 *
 * @example
 * ```tsx
 * // Standard card with header and content
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Title</CardTitle>
 *     <CardDescription>Description text</CardDescription>
 *   </CardHeader>
 *   <CardContent>
 *     <p>Card content goes here</p>
 *   </CardContent>
 * </Card>
 *
 * // Floating elevated card
 * <Card elevation="floating">
 *   <CardContent>Elevated content</CardContent>
 * </Card>
 *
 * // Inset card for empty states
 * <Card elevation="inset">
 *   <CardContent className="text-center">
 *     <p>No items found</p>
 *   </CardContent>
 * </Card>
 *
 * // Card with header action
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Title</CardTitle>
 *     <CardAction>
 *       <Button size="sm">Action</Button>
 *     </CardAction>
 *   </CardHeader>
 * </Card>
 * ```
 */
function Card({
  elevation = "raised",
  interactive = false,
  className,
  ...props
}: CardProps) {
  return (
    <Surface
      elevation={elevation}
      interactive={interactive}
      data-slot="card"
      className={cn(
        "text-card-foreground flex flex-col gap-6 py-6",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6 grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-semibold leading-none", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("[.border-t]:pt-6 flex items-center px-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
