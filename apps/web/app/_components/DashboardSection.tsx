"use client";

import { useRouter } from "next/navigation";
import {
  Button,
  ItemList,
  type ListItem,
  type LucideIcon,
} from "@dashframe/ui";
import { LuArrowRight } from "react-icons/lu";

export interface DashboardSectionProps {
  /** Section title displayed in header */
  title: string;
  /** Optional icon to display before the title */
  icon?: LucideIcon;
  /** Route path for "View all" button */
  viewAllHref: string;
  /** Items to display in the ItemList */
  items: ListItem[];
  /** Callback when an item is selected */
  onItemSelect: (id: string) => void;
  /** Gap between items in pixels */
  gap?: number;
  /** Hide section when items is empty */
  hideWhenEmpty?: boolean;
}

/**
 * DashboardSection - Reusable section for dashboard views
 *
 * Renders a section with a title, "View all" navigation button,
 * and a grid of items using ItemList.
 */
export function DashboardSection({
  title,
  icon: Icon,
  viewAllHref,
  items,
  onItemSelect,
  gap = 12,
  hideWhenEmpty = true,
}: DashboardSectionProps) {
  const router = useRouter();

  if (hideWhenEmpty && items.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          {Icon && <Icon className="h-5 w-5" />}
          {title}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(viewAllHref)}
        >
          View all
          <LuArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      <ItemList
        items={items}
        onSelect={onItemSelect}
        orientation="grid"
        gap={gap}
      />
    </div>
  );
}
