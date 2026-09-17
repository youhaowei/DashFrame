/** The host's copy of the runtime declaration keeps every key the codec stores. */
import { describe, expect, it } from "vite-plus/test";
import { runtimeControlsSchema } from "./insights";

describe("runtimeControlsSchema", () => {
  it("keeps the label and changeable ceiling of each declared control", () => {
    const declaration = {
      filters: [
        { key: "region", filterId: "f-1", label: "Region", changeable: false },
      ],
      sort: {
        label: "Order",
        allowedFieldIds: ["field-1"],
        maxKeys: 1,
        changeable: false,
      },
      limit: { label: "Rows", min: 1, max: 50, changeable: false },
    };
    expect(runtimeControlsSchema.parse(declaration)).toEqual(declaration);
  });
});
