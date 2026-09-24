import { describe, expect, it } from "vite-plus/test";

import {
  AGGREGATIONS,
  isMeasureContract,
  measureContractProblem,
} from "./metric";

describe("measure contract", () => {
  it.each([
    [{ kind: "additive" }, true],
    [{ kind: "additive", additiveOver: ["time", "session"] }, true],
    [{ kind: "additive", additiveOver: [] }, true],
    [{ kind: "ratio" }, true],
    [{ kind: "non-additive" }, true],
    [{ kind: "additive", additiveOver: ["account"] }, false],
    [{ kind: "additive", additiveOver: "time" }, false],
    [{ kind: "ratio", additiveOver: ["time"] }, false],
    [{ kind: "ratio", extra: true }, false],
    [{ kind: "unknown" }, false],
    [null, false],
  ] as const)("validates %j as %s", (contract, valid) => {
    expect(isMeasureContract(contract)).toBe(valid);
  });

  it.each([
    [{ contract: { kind: "ratio" } }, "Ratio measures require an expression"],
    [
      {
        contract: { kind: "ratio" },
        expression: { kind: "constant", value: 1 },
      },
      null,
    ],
    [{ contract: { kind: "additive" } }, null],
    [{ contract: { kind: "non-additive" } }, null],
    [
      { contract: { kind: "ratio", extra: true } },
      "Ratio measures require an expression",
    ],
    [
      { contract: { kind: "ratio" }, expression: null },
      "Ratio measures require an expression",
    ],
  ] as const)("reports the ratio problem for %j", (metric, problem) => {
    expect(measureContractProblem(metric)).toBe(problem);
  });

  it("keeps the public aggregation list in the expected order", () => {
    expect(AGGREGATIONS).toEqual([
      "sum",
      "avg",
      "count",
      "min",
      "max",
      "count_distinct",
    ]);
  });
});
