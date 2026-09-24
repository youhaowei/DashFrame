import { describe, expect, it } from "vite-plus/test";

import { groupByKey, groupByRecency } from "./collection-groups";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Local noon, so "today" has twelve hours on either side of now.
const now = new Date(2026, 8, 24, 12, 0, 0).getTime();
const at = (name: string, time: number) => ({ name, time });

describe("groupByRecency", () => {
  it("buckets newest first into Today, This week and Earlier", () => {
    const groups = groupByRecency(
      [
        at("last month", now - 30 * DAY),
        at("this morning", now - 3 * HOUR),
        at("six days ago", now - 6 * DAY),
        at("just now", now),
        at("yesterday", now - DAY),
      ],
      now,
      (item) => item.time,
    );

    expect(
      groups.map((group) => [group.label, group.items.map((i) => i.name)]),
    ).toEqual([
      ["Today", ["just now", "this morning"]],
      ["This week", ["yesterday", "six days ago"]],
      ["Earlier", ["last month"]],
    ]);
  });

  it("starts Today at local midnight, not 24 hours ago", () => {
    const midnight = new Date(2026, 8, 24).getTime();
    const groups = groupByRecency(
      [at("after midnight", midnight), at("before midnight", midnight - 1)],
      now,
      (item) => item.time,
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "This week"]);
  });

  it("leaves empty buckets out", () => {
    const groups = groupByRecency(
      [at("old", now - 60 * DAY)],
      now,
      (item) => item.time,
    );

    expect(groups.map((group) => group.label)).toEqual(["Earlier"]);
  });
});

describe("groupByKey", () => {
  it("groups by key, orders groups by label and keeps item order", () => {
    const sources = [
      { name: "Docs site", type: "googleAnalytics" },
      { name: "Orders", type: "local" },
      { name: "Marketing site", type: "googleAnalytics" },
    ];
    const labels: Record<string, string> = {
      googleAnalytics: "Google Analytics 4",
      local: "Local Files",
    };

    const groups = groupByKey(
      sources,
      (source) => source.type,
      (key) => labels[key] ?? key,
    );

    expect(
      groups.map((group) => [group.label, group.items.map((s) => s.name)]),
    ).toEqual([
      ["Google Analytics 4", ["Docs site", "Marketing site"]],
      ["Local Files", ["Orders"]],
    ]);
  });
});
