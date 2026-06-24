/**
 * Command guide — internal consistency.
 *
 * The cross-package FRESHNESS check (guide vs the live COMMAND_PATHS registry)
 * lives in apps/server/src/functions/command-guide-freshness.test.ts, where the
 * real registry is importable. Here we pin the guide's self-consistency: every
 * documented entry has a non-empty contract, names are unique, and the rendered
 * text is well-formed.
 */

import { describe, expect, it } from "vitest";

import {
  COMMAND_GUIDE,
  GUIDE_COMMAND_NAMES,
  renderCommandGuide,
} from "./command-guide.js";

describe("command guide — self consistency", () => {
  it("every entry has a name, summary, and at least one arg", () => {
    for (const e of COMMAND_GUIDE) {
      expect(e.name, "name").toBeTruthy();
      expect(e.summary.length, `${e.name} summary`).toBeGreaterThan(0);
      expect(Object.keys(e.args).length, `${e.name} args`).toBeGreaterThan(0);
    }
  });

  it("command names are unique", () => {
    const names = COMMAND_GUIDE.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("GUIDE_COMMAND_NAMES exactly mirrors the guide entries", () => {
    expect(GUIDE_COMMAND_NAMES.size).toBe(COMMAND_GUIDE.length);
    for (const e of COMMAND_GUIDE)
      expect(GUIDE_COMMAND_NAMES.has(e.name)).toBe(true);
  });

  it("renders a non-empty block naming a command and the source fallback", () => {
    const text = renderCommandGuide();
    expect(text).toContain("AddField");
    expect(text).toContain("apps/server/src/functions/commands.ts");
  });
});
