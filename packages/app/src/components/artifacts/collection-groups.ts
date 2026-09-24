/** A labelled run of collection items, in display order. */
export type CollectionGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

/**
 * Newest first, bucketed into Today (since local midnight), This week (the six
 * days before that) and Earlier. Empty buckets are left out.
 */
export function groupByRecency<T>(
  items: readonly T[],
  now: number,
  timeOf: (item: T) => number,
): CollectionGroup<T>[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const todayStart = midnight.getTime();
  // Calendar days, not 24-hour spans, so a DST change keeps local midnight.
  midnight.setDate(midnight.getDate() - 6);
  const weekStart = midnight.getTime();

  const groups: CollectionGroup<T>[] = [
    { key: "today", label: "Today", items: [] },
    { key: "this-week", label: "This week", items: [] },
    { key: "earlier", label: "Earlier", items: [] },
  ];
  const bucketOf = (time: number) => {
    if (time >= todayStart) return 0;
    if (time >= weekStart) return 1;
    return 2;
  };
  for (const item of [...items].sort((a, b) => timeOf(b) - timeOf(a))) {
    groups[bucketOf(timeOf(item))]!.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

/**
 * One group per key, ordered by label, items kept in their given order.
 */
export function groupByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  labelOf: (key: string) => string,
): CollectionGroup<T>[] {
  const byKey = new Map<string, CollectionGroup<T>>();
  for (const item of items) {
    const key = keyOf(item);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: labelOf(key), items: [] };
      byKey.set(key, group);
    }
    group.items.push(item);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}
