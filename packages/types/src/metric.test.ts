import { describe, expect, it } from "vite-plus/test";

import {
  isMeasureContract,
  measureCombinesOver,
  measureContractProblem,
  type GrainScope,
  type MeasureContract,
} from "./metric";

const additiveOverTime: MeasureContract = {
  kind: "additive",
  additiveOver: ["time"],
};

describe("measureCombinesOver", () => {
  const cases: Array<
    [
      label: string,
      contract: MeasureContract | undefined,
      dropped: (GrainScope | undefined)[],
      expected: boolean,
    ]
  > = [
    ["no contract, scoped dimension", undefined, ["user"], true],
    ["unrestricted additive, any scope", { kind: "additive" }, ["user"], true],
    ["restricted additive, allowed scope", additiveOverTime, ["time"], true],
    [
      "restricted additive, one disallowed scope among allowed",
      additiveOverTime,
      ["time", "session"],
      false,
    ],
    [
      "restricted additive, unscoped dimension fails closed",
      additiveOverTime,
      [undefined],
      false,
    ],
    ["ratio, nothing dropped", { kind: "ratio" }, [], false],
    ["non-additive, nothing dropped", { kind: "non-additive" }, [], false],
  ];

  it.each(cases)("%s", (_label, contract, dropped, expected) => {
    expect(measureCombinesOver(contract, dropped)).toBe(expected);
  });
});

describe("measure contract", () => {
  it.each([
    [{ kind: "additive" }, true],
    [{ kind: "additive", additiveOver: ["time", "session"] }, true],
    [{ kind: "ratio" }, true],
    [{ kind: "non-additive" }, true],
    [{ kind: "additive", additiveOver: ["account"] }, false],
    [{ kind: "additive", additiveOver: "time" }, false],
    [{ kind: "ratio", additiveOver: ["time"] }, false],
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
  ] as const)("reports the ratio problem for %j", (metric, problem) => {
    expect(measureContractProblem(metric)).toBe(problem);
  });
});
