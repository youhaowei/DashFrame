import type {
  Dashboard,
  DashboardControl,
  DataTable,
  Insight,
  UUID,
  Visualization,
} from "@dashframe/types";
import { fieldIdToColumnAlias } from "@dashframe/engine";
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
import {
  DashboardControlsManager,
  resolveDashboardControlCandidates,
} from "./DashboardControlsManager";

const tableId = "10000000-0000-4000-8000-000000000001" as UUID;
const fieldId = "10000000-0000-4000-8000-000000000002" as UUID;
const insightId = "10000000-0000-4000-8000-000000000003" as UUID;
const visualizationId = "10000000-0000-4000-8000-000000000004" as UUID;
const itemId = "10000000-0000-4000-8000-000000000005" as UUID;
const table = {
  id: tableId,
  name: "Orders",
  dataFrameId: "orders-frame",
  fields: [
    {
      id: fieldId,
      tableId,
      name: "Revenue",
      columnName: "revenue",
      type: "number",
    },
  ],
} as DataTable;
const insight = {
  id: insightId,
  name: "Revenue question",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [],
  metrics: [],
  filters: [
    { id: "revenue-filter", field: "revenue", operator: "eq", value: 500 },
  ],
  runtimeControls: {
    filters: [
      {
        key: "revenue",
        filterId: "revenue-filter",
        label: "Revenue",
        allowClear: true,
      },
    ],
  },
  createdAt: 0,
} as Insight;
const visualization = {
  id: visualizationId,
  insightId,
  name: "Revenue by month",
  visualizationType: "barY",
  encoding: {},
  createdAt: 0,
} as Visualization;
const item = {
  id: itemId,
  type: "visualization" as const,
  visualizationId,
  x: 0,
  y: 0,
  width: 6,
  height: 6,
};

function Manager({
  controls = [],
  onSave,
}: {
  controls?: DashboardControl[];
  onSave: (controls: DashboardControl[]) => Promise<void>;
}) {
  return (
    <DashboardControlsManager
      controls={controls}
      items={[item]}
      visualizations={[visualization]}
      insights={[insight]}
      dataTables={[table]}
      onSave={onSave}
    />
  );
}

describe("DashboardControlsManager", () => {
  beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
  afterEach(() => vi.unstubAllGlobals());

  it("creates a typed control only for explicitly selected saved views while preserving existing controls", async () => {
    const user = userEvent.setup({ delay: null });
    const existing = {
      id: "10000000-0000-4000-8000-000000000006" as UUID,
      field: "region",
      label: "Region",
      defaultValue: "West",
      boundInstances: [],
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Manager controls={[existing]} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Shared controls" }));
    await user.click(screen.getByRole("button", { name: "Add control" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter" }),
      "revenue",
    );
    await user.type(screen.getByLabelText("Label"), "Minimum revenue");
    await user.type(screen.getByLabelText("Default value"), "1000");
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Revenue by month",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    await user.click(
      screen.getByRole("checkbox", { name: "Revenue by month" }),
    );
    await user.click(screen.getByRole("button", { name: "Save control" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0]?.[0] as DashboardControl[];
    expect(saved[0]).toEqual(existing);
    expect(saved[1]).toMatchObject({
      field: "revenue",
      label: "Minimum revenue",
      defaultValue: 1000,
      boundInstances: [itemId],
    });
  });

  it("reopens a saved control, preserves targets, and clears its default to include all", async () => {
    const user = userEvent.setup({ delay: null });
    const control = {
      id: "10000000-0000-4000-8000-000000000007" as UUID,
      field: "revenue",
      label: "Revenue",
      defaultValue: 750,
      boundInstances: [itemId],
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Manager controls={[control]} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Shared controls" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      (screen.getByLabelText("Default value") as HTMLInputElement).value,
    ).toBe("750");
    await user.clear(screen.getByLabelText("Default value"));
    await user.click(screen.getByRole("button", { name: "Save control" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        {
          id: control.id,
          field: "revenue",
          label: "Revenue",
          boundInstances: [itemId],
        },
      ]),
    );
  });

  it("keeps save failures visible without losing the editor", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <Manager onSave={vi.fn().mockRejectedValue(new Error("write failed"))} />,
    );
    await user.click(screen.getByRole("button", { name: "Shared controls" }));
    await user.click(screen.getByRole("button", { name: "Add control" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter" }),
      "revenue",
    );
    await user.click(screen.getByRole("button", { name: "Save control" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "write failed",
    );
    expect(screen.getByRole("button", { name: "Save control" })).toBeTruthy();
  });
});

it("excludes undeclared, ambiguous, malformed, and non-equality filters", () => {
  const variants = [
    { ...insight, id: "undeclared", runtimeControls: undefined },
    {
      ...insight,
      id: "ambiguous",
      filters: [
        ...insight.filters,
        { id: "other", field: "revenue", operator: "eq", value: 1 },
      ],
    },
    {
      ...insight,
      id: "malformed",
      filters: [{ field: "revenue", operator: "eq", value: 1 }],
    },
    {
      ...insight,
      id: "not-equality",
      filters: [{ ...insight.filters[0]!, operator: "gt" }],
    },
    {
      ...insight,
      id: "required",
      runtimeControls: {
        filters: [{ ...insight.runtimeControls!.filters![0]!, required: true }],
      },
    },
    {
      ...insight,
      id: "cannot-clear",
      runtimeControls: {
        filters: [
          { ...insight.runtimeControls!.filters![0]!, allowClear: false },
        ],
      },
    },
  ] as Insight[];
  const items = variants.map((candidate, index) => ({
    ...item,
    id: `item-${index}` as UUID,
    visualizationId: `viz-${index}` as UUID,
  }));
  const visualizations = variants.map((candidate, index) => ({
    ...visualization,
    id: `viz-${index}` as UUID,
    insightId: candidate.id,
  }));

  expect(
    resolveDashboardControlCandidates({
      items: items as Dashboard["items"],
      visualizations,
      insights: variants,
      dataTables: [table],
    }),
  ).toEqual([]);
});

it("normalizes a declared field alias to the raw source column", () => {
  const aliased = {
    ...insight,
    filters: [
      {
        ...insight.filters[0]!,
        field: fieldIdToColumnAlias(fieldId),
      },
    ],
  } as Insight;

  expect(
    resolveDashboardControlCandidates({
      items: [item],
      visualizations: [visualization],
      insights: [aliased],
      dataTables: [table],
    }),
  ).toEqual([
    {
      field: "revenue",
      label: "Revenue",
      type: "number",
      instances: [{ id: itemId, label: "Revenue by month" }],
    },
  ]);
});
