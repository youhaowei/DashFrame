import { describe, expect, it } from "vite-plus/test";

import {
  AGGREGATIONS,
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
    ["no contract, unscoped dimension", undefined, [undefined], true],
    ["unrestricted additive, any scope", { kind: "additive" }, ["user"], true],
    [
      "unrestricted additive, unscoped dimension",
      { kind: "additive" },
      [undefined],
      true,
    ],
    ["restricted additive, nothing dropped", additiveOverTime, [], true],
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
    [
      "additive over no scopes, any scope",
      { kind: "additive", additiveOver: [] },
      ["time"],
      false,
    ],
    ["ratio, nothing dropped", { kind: "ratio" }, [], false],
    ["ratio, scoped dimension", { kind: "ratio" }, ["time"], false],
    ["non-additive, nothing dropped", { kind: "non-additive" }, [], false],
    [
      "non-additive, scoped dimension",
      { kind: "non-additive" },
      ["time"],
      false,
    ],
  ];

  it.each(cases)("%s", (_label, contract, dropped, expected) => {
    expect(measureCombinesOver(contract, dropped)).toBe(expected);
  });
});

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
