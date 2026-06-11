import { describe, expect, it } from "vitest";

import { PerfStage, classifyDuration } from "./stages";

describe("classifyDuration", () => {
  it("marks an owned stage within budget as ok", () => {
    // CommandApply budget is 100ms.
    expect(classifyDuration(PerfStage.CommandApply, 80)).toBe("ok");
    expect(classifyDuration(PerfStage.CommandApply, 100)).toBe("ok");
  });

  it("marks an owned stage in the warn band (within 1.5x budget)", () => {
    expect(classifyDuration(PerfStage.CommandApply, 120)).toBe("warn");
    expect(classifyDuration(PerfStage.CommandApply, 150)).toBe("warn");
  });

  it("marks an owned stage beyond 1.5x budget as over", () => {
    expect(classifyDuration(PerfStage.CommandApply, 151)).toBe("over");
    expect(classifyDuration(PerfStage.CommandApply, 1000)).toBe("over");
  });

  it("applies the ~16ms next-frame budget to input echo", () => {
    expect(classifyDuration(PerfStage.InputEcho, 16)).toBe("ok");
    expect(classifyDuration(PerfStage.InputEcho, 24)).toBe("warn");
    expect(classifyDuration(PerfStage.InputEcho, 25)).toBe("over");
  });

  it("treats unowned waits (connector fetch) as attribution-only, never a verdict", () => {
    // No budget — slow or fast, the classification is `unowned`, so the HUD
    // never paints a green/amber/red verdict on a wait we don't own.
    expect(classifyDuration(PerfStage.ConnectorFetch, 5)).toBe("unowned");
    expect(classifyDuration(PerfStage.ConnectorFetch, 50_000)).toBe("unowned");
  });

  it("holds data-backed pipeline stages against the 500ms anchor", () => {
    expect(classifyDuration(PerfStage.Execute, 400)).toBe("ok");
    expect(classifyDuration(PerfStage.Execute, 600)).toBe("warn");
    expect(classifyDuration(PerfStage.Execute, 800)).toBe("over");
  });
});
