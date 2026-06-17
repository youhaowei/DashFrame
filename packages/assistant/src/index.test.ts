import { describe, expect, it } from "vitest";

describe("pi dependency smoke", () => {
  it("imports Agent from @earendil-works/pi-agent-core", async () => {
    const { Agent } = await import("@earendil-works/pi-agent-core");
    expect(Agent).toBeDefined();
  });

  it("imports getModel from @earendil-works/pi-ai", async () => {
    const { getModel } = await import("@earendil-works/pi-ai");
    expect(getModel).toBeDefined();
  });
});
