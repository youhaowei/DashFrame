import { describe, expect, it } from "vite-plus/test";

import {
  formatRelativeTime,
  formatRelativeTimeWithVerb,
} from "./format-relative-time";

describe("formatRelativeTime", () => {
  const now = 1_800_000_000_000;

  it("reads a timestamp just ahead of the minute clock as just now", () => {
    expect(formatRelativeTime(now, now + 30_000)).toBe("just now");
  });

  it("does not call a timestamp two hours ahead fresh", () => {
    expect(formatRelativeTime(now, now + 2 * 3_600_000)).toBe("—");
  });

  it("shows a placeholder before the client clock starts", () => {
    expect(formatRelativeTime(0, now)).toBe("—");
  });

  it("uses the largest whole unit", () => {
    expect(formatRelativeTime(now, now - 5 * 60_000)).toBe("5m ago");
    expect(formatRelativeTime(now, now - 3 * 3_600_000)).toBe("3h ago");
    expect(formatRelativeTime(now, now - 2 * 86_400_000)).toBe("2d ago");
  });

  it("keeps an unknown time bare instead of prefixing a verb", () => {
    expect(formatRelativeTimeWithVerb("updated", now, now - 60_000)).toBe(
      "updated 1m ago",
    );
    expect(
      formatRelativeTimeWithVerb("refreshed", now, now + 2 * 3_600_000),
    ).toBe("—");
  });
});
