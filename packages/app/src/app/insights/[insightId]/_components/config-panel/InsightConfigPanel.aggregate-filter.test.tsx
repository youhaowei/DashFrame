import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
import { metricIdToColumnAlias } from "@dashframe/engine";
import type {
  Command,
  DataTable,
  Insight,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const { commitBatch } = vi.hoisted(() => ({ commitBatch: vi.fn() }));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() => ({ data: [] })),
  useMutation: nativeMutationMock(() => ({ mutateAsync: commitBatch })),
}));
vi.mock("../sections/DataModelSection", () => ({
  DataModelSection: () => null,
}));
vi.mock("./FieldsSection", () => ({ FieldsSection: () => null }));
vi.mock("./MetricsSection", () => ({ MetricsSection: () => null }));
vi.mock("./SortSection", () => ({ SortSection: () => null }));
vi.mock("./DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: () => null,
  findVisualizationsUsingField: () => [],
  findVisualizationsUsingMetric: () => [],
  removeFromEncoding: (encoding: unknown) => encoding,
}));
vi.mock("./ReportSettings", () => ({
  ReportPeriodControl: () => null,
  ReportResultOptions: () => null,
}));
vi.mock("./MeasureLibraryControls", () => ({
  MeasureLibraryControls: () => null,
}));
vi.mock("@/components/visualizations/ReportSwitchers", () => ({
  ReportSelectionMenu: () => null,
}));

import { InsightConfigPanel } from "./InsightConfigPanel";

const tableId = "10000000-0000-4000-8000-000000000002" as UUID;
const amountId = "20000000-0000-4000-8000-000000000001" as UUID;
const revenue: InsightMetric = {
  id: "30000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue",
  sourceTable: tableId,
  columnName: "amount",
  aggregation: "sum",
};
const table = {
  id: tableId,
  dataSourceId: "source-1",
  name: "Orders",
  table: "orders",
  fields: [
    {
      id: amountId,
      tableId,
      name: "Amount",
      columnName: "amount",
      type: "number",
    },
  ],
  metrics: [],
  createdAt: 0,
} satisfies DataTable;
const insight = {
  id: "10000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue report",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [amountId],
  metrics: [revenue],
  filters: [],
  runtimeControls: {
    dimensions: { allowedIds: [amountId], maxSelected: 1 },
    measures: { allowedIds: [revenue.id], maxSelected: 1 },
  },
  createdAt: 0,
} satisfies Insight;

function panel(value: Insight) {
  return (
    <InsightConfigPanel
      insight={value}
      dataTable={table}
      allDataTables={[table]}
    />
  );
}

describe("InsightConfigPanel aggregate filters", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    commitBatch.mockReset();
    commitBatch.mockResolvedValue({});
  });

  afterEach(() => vi.unstubAllGlobals());

  it("saves a numeric measure predicate without clearing viewer switchers", async () => {
    const user = userEvent.setup({ delay: null });
    const view = render(panel(insight));

    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await user.click(screen.getByLabelText("Field"));
    await user.click(
      await screen.findByRole("option", { name: "Revenue (measure)" }),
    );
    await user.click(screen.getByLabelText("Operator"));
    await user.click(
      await screen.findByRole("option", { name: "is greater than" }),
    );
    await user.type(screen.getByLabelText("Value"), "1000");
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    const batch = commitBatch.mock.calls[0]![0] as { commands: Command[] };
    const filterCommand = batch.commands.find(
      (command) => command.path === "setInsightFilter",
    );
    expect(filterCommand).toMatchObject({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          {
            field: metricIdToColumnAlias(revenue.id),
            operator: "gt",
            value: 1000,
          },
        ],
      },
    });
    const runtimeCommand = batch.commands.find(
      (command) => command.path === "setInsightRuntimeControls",
    );
    if (runtimeCommand) {
      expect(runtimeCommand).toMatchObject({
        args: {
          runtimeControls: insight.runtimeControls,
        },
      });
    }

    if (!filterCommand) throw new Error("Missing filter command");
    const savedFilter = (
      filterCommand.args as {
        filters: NonNullable<Insight["filters"]>;
      }
    ).filters[0]!;
    view.rerender(panel({ ...insight, filters: [savedFilter] }));

    expect(
      screen.getByRole("button", { name: "Edit filter Revenue (measure)" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Edit filter Revenue (measure)" }),
    );
    expect(screen.getByLabelText("Field").textContent).toContain(
      "Revenue (measure)",
    );
    expect(screen.getByLabelText("Value")).toHaveProperty("type", "number");
    expect(screen.getByLabelText("Value")).toHaveProperty("value", "1000");
  }, 10_000);
});
