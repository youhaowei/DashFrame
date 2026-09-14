import { describe, expect, it } from "vite-plus/test";

import { metricFieldLabel } from "./MetricsSection";

const baseFields = [{ id: "qty", columnName: "quantity", name: "Quantity" }];

describe("metricFieldLabel", () => {
  it("names a base field by its column or its alias", () => {
    expect(metricFieldLabel("quantity", baseFields, {})).toBe("Quantity");
    expect(metricFieldLabel("field_qty", baseFields, {})).toBe("Quantity");
  });

  it("names a joined field instance from the result column labels", () => {
    // Joining users twice gives each instance its own alias, and the column
    // labels are what tell them apart.
    const labels = {
      field_dd05ef4b: "Name (created_by)",
      field_dd05ef4b_j1: "Name (approved_by)",
    };
    expect(metricFieldLabel("field_dd05ef4b_j1", baseFields, labels)).toBe(
      "Name (approved_by)",
    );
  });

  it("never returns an alias as a label", () => {
    expect(metricFieldLabel("field_ab12", baseFields, {})).toBeUndefined();
    expect(
      metricFieldLabel("field_ab12", baseFields, { field_ab12: "field_ab12" }),
    ).toBeUndefined();
  });
});
