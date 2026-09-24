import { describe, expect, it } from "vite-plus/test";

import {
  measureCombinesOver,
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
