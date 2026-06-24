/**
 * Command-guide FRESHNESS — the drift detector.
 *
 * The assistant's command vocabulary GUIDE (@dashframe/assistant) is the agent's
 * PRIMARY reference for the commands it can apply (the applyCommand tool). It is hand-crafted,
 * so it can DRIFT from the real command registry as commands are added/removed.
 * This test is the freshness check the ticket requires: it asserts the guide's
 * documented command names EXACTLY equal the live registry's command names
 * (COMMAND_PATHS keys — the single source of truth tying each cmd() name to its
 * dispatch path).
 *
 * A new command without a guide entry, or a removed command still documented,
 * FAILS here at CI — the guide cannot silently lie to the agent. The fix when it
 * fails is to update the guide (COMMAND_GUIDE in
 * packages/assistant/src/read/command-guide.ts), not to weaken this test.
 */

import { GUIDE_COMMAND_NAMES } from "@dashframe/assistant";
import { describe, expect, it } from "vitest";

import { COMMAND_PATHS } from "./commands";

describe("command guide freshness (guide ⟷ cmd() registry)", () => {
  const registryNames = new Set(Object.keys(COMMAND_PATHS));
  const guideNames = GUIDE_COMMAND_NAMES;

  it("documents every command in the registry (no undocumented command)", () => {
    const missing = [...registryNames].filter((n) => !guideNames.has(n));
    expect(missing, "registry commands missing from the guide").toEqual([]);
  });

  it("documents no command that the registry does not define (no stale entry)", () => {
    const stale = [...guideNames].filter((n) => !registryNames.has(n));
    expect(stale, "guide entries not in the registry").toEqual([]);
  });

  it("guide and registry have identical command-name sets", () => {
    expect([...guideNames].sort()).toEqual([...registryNames].sort());
  });
});
