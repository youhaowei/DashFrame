import {
  BreadcrumbItem as BreadcrumbItemPrimitive,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  Breadcrumb as BreadcrumbPrimitive,
  BreadcrumbSeparator,
} from "@wystack/ui";
import type { ReactNode } from "react";
import { Fragment } from "react";

export interface BreadcrumbItem {
  /** Item label */
  label: string | ReactNode;
  /** Destination path (if clickable; omit for current page) */
  to?: string;
  /** Custom render function for the item (overrides default rendering) */
  render?: () => ReactNode;
}

export interface BreadcrumbProps {
  /** Navigation items */
  items: BreadcrumbItem[];
  /** Custom Link component (e.g., TanStack Router's Link) */
  LinkComponent?: React.ComponentType<{ to: string; children: ReactNode }>;
}

/**
 * Breadcrumb - Navigation breadcrumb component
 *
 * Displays hierarchical navigation with automatic current page detection.
 * Last item without `to` is treated as current page.
 *
 * @example
 * ```tsx
 * import { Link } from "@tanstack/react-router";
 *
 * <Breadcrumb
 *   LinkComponent={Link}
 *   items={[
 *     { label: "Home", to: "/" },
 *     { label: "Insights", to: "/insights" },
 *     { label: "My Insight" }, // Current page
 *   ]}
 * />
 * ```
 */
export function Breadcrumb({ items, LinkComponent }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <BreadcrumbPrimitive>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          // Custom render
          if (item.render) {
            return (
              <Fragment key={index}>
                <BreadcrumbItemPrimitive>
                  {item.render()}
                </BreadcrumbItemPrimitive>
                {!isLast && <BreadcrumbSeparator />}
              </Fragment>
            );
          }

          // Clickable link
          if (item.to && LinkComponent) {
            return (
              <Fragment key={index}>
                <BreadcrumbItemPrimitive>
                  <BreadcrumbLink asChild>
                    <LinkComponent to={item.to}>{item.label}</LinkComponent>
                  </BreadcrumbLink>
                </BreadcrumbItemPrimitive>
                {!isLast && <BreadcrumbSeparator />}
              </Fragment>
            );
          }

          // Current page (non-clickable)
          return (
            <Fragment key={index}>
              <BreadcrumbItemPrimitive>
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              </BreadcrumbItemPrimitive>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </BreadcrumbPrimitive>
  );
}
