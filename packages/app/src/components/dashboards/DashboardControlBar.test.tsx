import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DashboardControl, InsightFilter, UUID } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { DashboardControlBar } from "./DashboardControlBar";

function field(name: string, type: CombinedField["type"]): CombinedField {
  return {
    id: `${name}-field` as UUID,
    tableId: "table" as UUID,
    sourceTableId: "table" as UUID,
    name,
    displayName: name,
    columnName: name.toLowerCase(),
    type,
  };
}

function control(
  id: string,
  fieldName: string,
  defaultValue: InsightFilter["value"],
): DashboardControl {
  return {
    id: id as UUID,
    field: fieldName,
    label: fieldName,
    defaultValue,
    boundInstances: [],
  };
}

it("emits typed boolean values and a blank include-all value", async () => {
  const user = userEvent.setup({ delay: null });
  const onTransientChange = vi.fn();
  const active = control("active-control", "active", false);
  render(
    <DashboardControlBar
      controls={[active]}
      fieldsByName={new Map([["active", field("active", "boolean")]])}
      transientValues={new Map()}
      onTransientChange={onTransientChange}
    />,
  );
  const input = screen.getByRole("combobox", { name: "Control: active" });
  expect((input as HTMLSelectElement).value).toBe("false");

  await user.selectOptions(input, "true");
  let values = onTransientChange.mock.calls.at(-1)?.[0] as Map<string, unknown>;
  expect(values.get(active.id)).toBe(true);

  await user.selectOptions(input, "");
  values = onTransientChange.mock.calls.at(-1)?.[0] as Map<string, unknown>;
  expect(values.get(active.id)).toBe("");
});

it("preserves numeric coercion and date strings", () => {
  const onTransientChange = vi.fn();
  render(
    <DashboardControlBar
      controls={[
        control("amount-control", "amount", 5),
        control("date-control", "order_date", "2026-09-22"),
      ]}
      fieldsByName={
        new Map([
          ["amount", field("amount", "number")],
          ["order_date", field("order_date", "date")],
        ])
      }
      transientValues={new Map()}
      onTransientChange={onTransientChange}
    />,
  );

  const amount = screen.getByLabelText("Control: amount");
  fireEvent.change(amount, { target: { value: "12.5" } });
  let values = onTransientChange.mock.calls.at(-1)?.[0] as Map<string, unknown>;
  expect(values.get("amount-control")).toBe(12.5);

  const date = screen.getByLabelText("Control: order_date");
  fireEvent.change(date, { target: { value: "2026-10-01" } });
  values = onTransientChange.mock.calls.at(-1)?.[0] as Map<string, unknown>;
  expect(values.get("date-control")).toBe("2026-10-01");
});
