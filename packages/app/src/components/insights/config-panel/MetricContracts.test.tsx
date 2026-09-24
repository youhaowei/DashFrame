import type { DataTable, MeasureContract } from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MetricsSection } from "./MetricsSection";

const expectedContracts = {
  activeUsers: { kind: "non-additive" },
  sessions: { kind: "additive", additiveOver: ["time", "session"] },
} satisfies Record<string, MeasureContract>;

function table(
  columnName: "activeUsers" | "sessions",
  ga4: boolean,
): DataTable {
  return {
    id: "table-1",
    name: ga4 ? "Acquisition" : "CSV import",
    dataSourceId: "source-1",
    table: ga4 ? "properties/1" : "report.csv",
    fields: [
      ...(ga4
        ? [
            {
              id: "week",
              name: "Week",
              tableId: "table-1",
              columnName: "yearWeek",
              type: "date" as const,
              scope: "time" as const,
            },
            {
              id: "channel",
              name: "Channel",
              tableId: "table-1",
              columnName: "sessionDefaultChannelGroup",
              type: "string" as const,
              scope: "session" as const,
            },
          ]
        : []),
      {
        id: "measure-column",
        name: columnName === "activeUsers" ? "Active users" : "Sessions",
        tableId: "table-1",
        columnName,
        type: "number",
      },
    ],
    metrics: [],
    createdAt: 1,
  } as DataTable;
}

async function addSum(dataTable: DataTable, onAdd: ReturnType<typeof vi.fn>) {
  const user = userEvent.setup({ delay: null });
  render(
    <MetricsSection
      metrics={[]}
      dataTable={dataTable}
      onReorder={vi.fn()}
      onRemove={vi.fn()}
      onAdd={onAdd}
      onEdit={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Add metric" }));
  await user.click(screen.getByRole("combobox", { name: "Aggregation" }));
  await user.click(await screen.findByRole("option", { name: "Sum" }));
  await user.click(screen.getByRole("combobox", { name: "Column" }));
  const field = dataTable.fields.at(-1)!;
  await user.click(await screen.findByRole("option", { name: field.name }));
  return user;
}

describe("new metric contracts", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it.each([
    [
      "activeUsers",
      "Not additive across weeks or channels",
      expectedContracts.activeUsers,
    ],
    [
      "sessions",
      "Additive across weeks and channels",
      expectedContracts.sessions,
    ],
  ] as const)(
    "inherits the GA4 %s contract from connector metadata",
    async (columnName, description, contract) => {
      const onAdd = vi.fn();
      const user = await addSum(table(columnName, true), onAdd);

      expect(screen.getByText(description)).toBeTruthy();
      await user.click(
        screen.getByRole("button", { name: "Add", exact: true }),
      );

      await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
      expect(onAdd.mock.calls[0]![0]).toMatchObject({ columnName, contract });
    },
    10_000,
  );

  it("does not treat a same-named CSV column as GA4 metadata", async () => {
    const onAdd = vi.fn();
    const user = await addSum(table("activeUsers", false), onAdd);

    expect(
      screen.queryByText("Not additive across weeks or channels"),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add", exact: true }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0]![0]).not.toHaveProperty("contract");
  });

  it("prefers a matching saved measure contract", async () => {
    const dataTable = table("sessions", true);
    dataTable.metrics = [
      {
        id: "saved-sessions",
        name: "Custom sessions",
        tableId: dataTable.id,
        columnName: "sessions",
        aggregation: "sum",
        contract: { kind: "non-additive" },
      },
    ];
    const onAdd = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <MetricsSection
        metrics={[]}
        dataTable={dataTable}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onAdd={onAdd}
        onEdit={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add metric" }));
    await user.click(screen.getByRole("combobox", { name: "Aggregation" }));
    await user.click(await screen.findByRole("option", { name: "Sum" }));
    await user.click(screen.getByRole("combobox", { name: "Column" }));
    await user.click(await screen.findByRole("option", { name: "Sessions" }));

    expect(
      screen.getByText("Not additive across weeks or channels"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add", exact: true }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0]![0]).toMatchObject({
      contract: { kind: "non-additive" },
    });
  });

  it("inherits the GA4 contract when changing an existing sessions measure to active users", async () => {
    const dataTable = table("activeUsers", true);
    dataTable.fields.push({
      id: "sessions",
      name: "Sessions",
      tableId: dataTable.id,
      columnName: "sessions",
      type: "number",
    });
    const onEdit = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <MetricsSection
        metrics={[
          {
            id: "session-measure",
            name: "Sum of Sessions",
            sourceTable: dataTable.id,
            columnName: "sessions",
            aggregation: "sum",
            contract: expectedContracts.sessions,
          },
        ]}
        dataTable={dataTable}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onEdit={onEdit}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Edit Sum of Sessions" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Column" }));
    await user.click(
      await screen.findByRole("option", { name: "Active users" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]![0]).toMatchObject({
      columnName: "activeUsers",
      contract: expectedContracts.activeUsers,
    });
  });
});
