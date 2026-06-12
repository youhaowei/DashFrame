import { describe, expect, it } from "vitest";

import { selectEngineBinding, type Deployment } from "./engine-selection";

describe("selectEngineBinding — engine selection policy (Stage 2)", () => {
  it("desktop resolves to the native loopback engine", () => {
    expect(selectEngineBinding("desktop")).toBe("native");
  });

  it("web resolves to WASM (renderer plays the server role)", () => {
    expect(selectEngineBinding("web")).toBe("wasm");
  });

  it("cloud resolves to cloud (future)", () => {
    expect(selectEngineBinding("cloud")).toBe("cloud");
  });

  it("is a pure function of the deployment — no other input decides", () => {
    // Same deployment, called many times, always the same binding: there is no
    // per-query branch. This is the contract that keeps placement a single seam.
    const deployments: Deployment[] = ["desktop", "web", "cloud"];
    for (const d of deployments) {
      const first = selectEngineBinding(d);
      for (let i = 0; i < 5; i++) {
        expect(selectEngineBinding(d)).toBe(first);
      }
    }
  });
});
