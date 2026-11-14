import { describe, expect, it } from "vite-plus/test";

describe("package export smoke", () => {
  it("imports this package through its package export", async () => {
    const assistant = await import("@dashframe/assistant");
    expect(assistant.createReadTools).toBeDefined();
  }, 30_000);
});
