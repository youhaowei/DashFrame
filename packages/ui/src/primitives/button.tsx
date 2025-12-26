import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        filled: "",
        outlined: "border bg-background shadow-xs",
        text: "",
        link: "underline-offset-4 hover:underline",
      },
      color: {
        primary: "",
        secondary: "",
        warn: "",
        danger: "",
        success: "",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    compoundVariants: [
      // ============ FILLED VARIANTS ============
      {
        variant: "filled",
        color: "primary",
        className:
          "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50",
      },
      {
        variant: "filled",
        color: "secondary",
        className:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-ring/50",
      },
      {
        variant: "filled",
        color: "warn",
        className:
          "bg-amber-500 text-white hover:bg-amber-500/90 focus-visible:ring-amber-500/20 dark:bg-amber-600",
      },
      {
        variant: "filled",
        color: "danger",
        className:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60",
      },
      {
        variant: "filled",
        color: "success",
        className:
          "bg-emerald-600 text-white hover:bg-emerald-600/90 focus-visible:ring-emerald-600/20 dark:bg-emerald-700",
      },

      // ============ OUTLINED VARIANTS ============
      {
        variant: "outlined",
        color: "primary",
        className:
          "border-primary/50 text-primary hover:bg-primary/10 hover:border-primary focus-visible:ring-primary/20",
      },
      {
        variant: "outlined",
        color: "secondary",
        className:
          "border-input hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 focus-visible:ring-ring/50",
      },
      {
        variant: "outlined",
        color: "warn",
        className:
          "border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:border-amber-500 focus-visible:ring-amber-500/20 dark:text-amber-500",
      },
      {
        variant: "outlined",
        color: "danger",
        className:
          "border-destructive/50 text-destructive hover:bg-destructive/10 hover:border-destructive focus-visible:ring-destructive/20",
      },
      {
        variant: "outlined",
        color: "success",
        className:
          "border-emerald-600/50 text-emerald-600 hover:bg-emerald-600/10 hover:border-emerald-600 focus-visible:ring-emerald-600/20",
      },

      // ============ TEXT (GHOST) VARIANTS ============
      {
        variant: "text",
        color: "primary",
        className:
          "text-primary hover:bg-primary/10 focus-visible:ring-primary/20",
      },
      {
        variant: "text",
        color: "secondary",
        className:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 focus-visible:ring-ring/50",
      },
      {
        variant: "text",
        color: "warn",
        className:
          "text-amber-600 hover:bg-amber-500/10 focus-visible:ring-amber-500/20 dark:text-amber-500",
      },
      {
        variant: "text",
        color: "danger",
        className:
          "text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/20",
      },
      {
        variant: "text",
        color: "success",
        className:
          "text-emerald-600 hover:bg-emerald-600/10 focus-visible:ring-emerald-600/20",
      },

      // ============ LINK VARIANTS ============
      {
        variant: "link",
        color: "primary",
        className: "text-primary",
      },
      {
        variant: "link",
        color: "secondary",
        className: "text-muted-foreground",
      },
      {
        variant: "link",
        color: "danger",
        className: "text-destructive",
      },
    ],
    defaultVariants: {
      variant: "filled",
      color: "primary",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "filled",
  color = "primary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-color={color}
      data-size={size}
      className={cn(buttonVariants({ variant, color, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
