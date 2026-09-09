import { useId } from "react";

import {
  DataPickerContent,
  type DataPickerContentProps,
} from "./DataPickerContent";

interface StartFromDataProps extends Pick<
  DataPickerContentProps,
  "onTableSelect" | "onInsightSelect" | "showInsights" | "onActivityChange"
> {
  /** The one line that says where the reader is. */
  title: string;
  /** The one next step. Omit when the title already says it. */
  description?: string;
  /**
   * `1` when this view is the page, `2` when it sits under a page heading that
   * already named the surface.
   * @default 1
   */
  headingLevel?: 1 | 2;
}

/**
 * "You have nothing here yet — start from data": a heading, the one next step,
 * and the data picker.
 *
 * The terminal action is the caller's. Picking a table means something
 * different on each surface it appears on — a first insight on an empty
 * project, a first question on an empty report list — and the layout is the
 * only part those surfaces actually share. Baking a `useCreateInsight` call in
 * here would make every future caller inherit one surface's product decision.
 *
 * Deliberately unadorned. The Stage is already the elevated surface these pages
 * sit on, so this adds no panel or card of its own — per DESIGN.md the app is a
 * working instrument, and an element that answers no question earns no place.
 *
 * @example
 * ```tsx
 * <StartFromData
 *   title="Welcome to DashFrame"
 *   description="Connect a data source to build your first insight."
 *   onTableSelect={createInsightFromTable}
 * />
 * ```
 */
export function StartFromData({
  title,
  description,
  headingLevel = 1,
  onTableSelect,
  onInsightSelect,
  showInsights = true,
  onActivityChange,
}: StartFromDataProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h1";

  return (
    <section aria-labelledby={headingId}>
      <Heading id={headingId} className="text-xl font-semibold text-neutral-fg">
        {title}
      </Heading>
      {description && (
        <p className="mt-1 text-sm text-neutral-fg-subtle">{description}</p>
      )}

      <div className="mt-8">
        <DataPickerContent
          onTableSelect={onTableSelect}
          onInsightSelect={onInsightSelect}
          showInsights={showInsights}
          onActivityChange={onActivityChange}
        />
      </div>
    </section>
  );
}
