import type { Field, Insight } from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { ReportSelectionMenu, ReportSwitchers } from "./ReportSwitchers";
const fields: Field[] = [
  { id: "date", name: "Month", type: "date", tableId: "source" },
  { id: "channel", name: "Channel", type: "string", tableId: "source" },
  { id: "country", name: "Country", type: "string", tableId: "source" },
];
const insight: Insight = {
  id: "report",
  name: "Report",
  source: { sourceType: "dataTable", sourceId: "source" },
  selectedFields: ["date", "channel"],
  metrics: [
    {
      id: "orders",
      name: "Orders",
      sourceTable: "source",
      aggregation: "count",
    },
    {
      id: "rate",
      name: "Conversion rate",
      sourceTable: "source",
      aggregation: "count",
    },
  ],
  runtimeControls: {
    dimensions: { allowedIds: ["date", "channel", "country"], maxSelected: 2 },
    measures: { allowedIds: ["orders", "rate"], maxSelected: 2 },
  },
  createdAt: 0,
};
describe("report reader switchers", () => {
  beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
  afterEach(() => vi.unstubAllGlobals());
  it("changes channel to country while retaining the monthly dimension", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <ReportSwitchers insight={insight} fields={fields} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Dimensions · 2" }));
    await user.click(screen.getByRole("checkbox", { name: "Channel" }));
    await user.click(screen.getByRole("checkbox", { name: "Country" }));
    await user.click(
      screen.getByRole("button", { name: "Apply", exact: true }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        dimensions: ["date", "country"],
      }),
    );
    expect(insight.selectedFields).toEqual(["date", "channel"]);
  });
  it("keeps switched-out dimensions available for a round trip", async () => {
    const user = userEvent.setup({ delay: null });
    function ControlledSwitchers() {
      const [runtime, setRuntime] =
        useState<Parameters<typeof ReportSwitchers>[0]["runtime"]>();
      return (
        <>
          <output>{JSON.stringify(runtime?.dimensions)}</output>
          <ReportSwitchers
            insight={insight}
            fields={fields}
            runtime={runtime}
            onChange={setRuntime}
          />
        </>
      );
    }
    render(<ControlledSwitchers />);

    await user.click(screen.getByRole("button", { name: "Dimensions · 2" }));
    await user.click(screen.getByRole("checkbox", { name: "Channel" }));
    await user.click(screen.getByRole("checkbox", { name: "Country" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await user.click(screen.getByRole("button", { name: "Dimensions · 2" }));
    expect(screen.getByRole("checkbox", { name: "Channel" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Country" }));
    await user.click(screen.getByRole("checkbox", { name: "Channel" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe('["date","channel"]'),
    );

    await user.click(screen.getByRole("button", { name: "Dimensions · 2" }));
    expect(screen.getByRole("checkbox", { name: "Country" })).toBeTruthy();
  });
  it("selects a measure while preserving the active dimensions and filter values", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    const runtime = {
      dimensions: ["date", "country"],
      filters: { region: "US" },
    };
    render(
      <ReportSwitchers
        insight={insight}
        fields={fields}
        runtime={runtime}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Measures · 2" }));
    await user.click(screen.getByRole("checkbox", { name: "Orders" }));
    await user.click(
      screen.getByRole("button", { name: "Apply", exact: true }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ ...runtime, measures: ["rate"] }),
    );
  });
  it("keeps author choices open when saving declarations fails", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ReportSelectionMenu
        label="Viewer choices"
        selected={["country"]}
        options={[{ id: "country", label: "Country" }]}
        onApply={() => Promise.reject(new Error("write failed"))}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Viewer choices · 1" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Apply", exact: true }),
    );
    expect(await screen.findByText("write failed")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Country" })).toBeTruthy();
  });
});
