"use client";

import type { ReactNode } from "react";
import { Fragment } from "react";
import {
  Breadcrumb as BreadcrumbPrimitive,
  BreadcrumbList,
  BreadcrumbItem as BreadcrumbItemPrimitive,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "../primitives/breadcrumb";

export interface BreadcrumbItem {
  /** Item label */
  label: string | ReactNode;
  /** Link href (if clickable, omit for current page) */
  href?: string;
  /** Custom render function for the item (overrides default rendering) */
  render?: () => ReactNode;
}

export interface BreadcrumbProps {
  /** Navigation items */
  items: BreadcrumbItem[];
  /** Custom Link component (e.g., Next.js Link) */
  LinkComponent?: React.ComponentType<{ href: string; children: ReactNode }>;
}

/**
 * Breadcrumb - Navigation breadcrumb component
 *
 * Displays hierarchical navigation with automatic current page detection.
 * Last item without href is treated as current page.
 *
 * @example
 * ```tsx
 * import Link from "next/link";
 *
 * <Breadcrumb
 *   LinkComponent={Link}
 *   items={[
 *     { label: "Home", href: "/" },
 *     { label: "Insights", href: "/insights" },
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
          if (item.href && LinkComponent) {
            return (
              <Fragment key={index}>
                <BreadcrumbItemPrimitive>
                  <BreadcrumbLink asChild>
                    <LinkComponent href={item.href}>{item.label}</LinkComponent>
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
