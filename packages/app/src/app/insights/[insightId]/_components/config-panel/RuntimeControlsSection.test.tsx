import type { InsightFilter, UUID } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { RuntimeControlsSection } from "./RuntimeControlsSection";

describe("RuntimeControlsSection", () => {
  it("authors a filter declaration from an existing saved filter id", () => {
    const onChange = vi.fn();
    render(
      <RuntimeControlsSection
        filters={[
          {
            id: "filter-id",
            field: "region",
            operator: "eq",
            value: "US",
          } as InsightFilter,
          {
            id: "segment-filter",
            field: "segment",
            operator: "eq",
            value: "Enterprise",
          } as InsightFilter,
        ]}
        resultFields={[{ id: "field-id" as UUID, label: "Region" }]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "region" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "segment" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save runtime controls" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      filters: [
        {
          key: "filter-filter-id",
          filterId: "filter-id",
          label: "region",
        },
        {
          key: "filter-segment-filter",
          filterId: "segment-filter",
          label: "segment",
        },
      ],
    });
  });
});
