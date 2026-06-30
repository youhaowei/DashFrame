import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("pi dependency smoke", () => {
  it("imports this package through its package export", async () => {
    const assistant = await import("@dashframe/assistant");
    expect(assistant.createReadTools).toBeDefined();
  }, 30_000);

  it("imports this package through Node's package export", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      "-e",
      "import('@dashframe/assistant').then((m) => console.log(typeof m.createReadTools))",
    ]);
    expect(stdout.trim()).toBe("function");
  }, 30_000);

  it("imports Agent from @earendil-works/pi-agent-core", async () => {
    const { Agent } = await import("@earendil-works/pi-agent-core");
    expect(Agent).toBeDefined();
  }, 30_000);

  it("imports getModel from @earendil-works/pi-ai", async () => {
    const { getModel } = await import("@earendil-works/pi-ai");
    expect(getModel).toBeDefined();
  }, 30_000);
});
