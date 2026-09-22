import type { Field, Insight } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { ReportPeriodControl, ReportResultOptions } from "./ReportSettings";

const field: Field = {
  id: "date",
  name: "Order date",
  columnName: "date",
  type: "date",
  tableId: "source",
};
const insight: Insight = {
  id: "report",
  name: "Report",
  source: { sourceType: "dataTable", sourceId: "source" },
  selectedFields: ["date"],
  metrics: [
    {
      id: "orders",
      name: "Orders",
      sourceTable: "source",
      aggregation: "count",
    },
  ],
  createdAt: 0,
};
describe("report setting editors", () => {
  it("saves a relative date range and previous-year comparison together", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(
      <ReportPeriodControl
        insight={insight}
        fields={[field]}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Period · All dates" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Date range" }));
    await user.click(
      await screen.findByRole("option", {
        name: "Previous month",
        exact: true,
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "Compare with" }));
    await user.click(
      await screen.findByRole("option", { name: "Previous year", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        dateRange: { fieldId: "date", range: { type: "previous_month" } },
        comparison: "previous_year",
      }),
    );
  });
  it("saves ranking, row limits, and totals as one report update", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn().mockResolvedValue(undefined);
    const country: Field = {
      ...field,
      id: "country",
      name: "Country",
      columnName: "country",
      type: "string",
    };
    render(
      <ReportResultOptions
        insight={{ ...insight, selectedFields: ["country"] }}
        fields={[country]}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Ranking, limit & totals" }),
    );
    fireEvent.change(screen.getByLabelText("Row limit (blank for all)"), {
      target: { value: "5" },
    });
    await user.click(screen.getByRole("combobox", { name: "Rank groups" }));
    await user.click(
      await screen.findByRole("option", { name: "Top N", exact: true }),
    );
    await user.click(
      screen.getByRole("combobox", { name: "Totals and KPI summary" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Show", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        topN: {
          fieldId: "country",
          measureId: "orders",
          count: 10,
          direction: "desc",
        },
        limit: 5,
        totals: true,
      }),
    );
  });

  it("rejects invalid limits and keeps an editor open when persistence fails", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn().mockRejectedValue(new Error("write failed"));
    render(
      <ReportResultOptions
        insight={insight}
        fields={[field]}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Ranking, limit & totals" }),
    );
    fireEvent.change(screen.getByLabelText("Row limit (blank for all)"), {
      target: { value: "0" },
    });
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Limit must",
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Row limit (blank for all)"), {
      target: { value: "10" },
    });
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    expect(await screen.findByText("write failed")).toBeTruthy();
    expect(screen.getByLabelText("Row limit (blank for all)")).toBeTruthy();
  });
});
