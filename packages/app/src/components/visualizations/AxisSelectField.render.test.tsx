/**
 * AxisSelectField component-render acceptance test for repeat-join instance identity.
 *
 * Acceptance criterion: for an insight with a repeat-join (orders→users on
 * created_by AND approved_by), the picker must expose BOTH join instances as
 * DISTINCT selectable options with distinct encoding values AND distinct
 * human-readable labels.  Selecting the second instance must emit the _j1
 * encoding (field:<uuid>_j1), not the bare-UUID encoding.
 *
 * This test renders AxisSelectField directly (it has no context providers —
 * only useCallback/useMemo React hooks) and intercepts the options passed to
 * the inner SelectField via a stub.  The stub records what options the component
 * computed, and records which value onChange was called with when the stub
 * simulates a selection.
 */

import {
  buildInsightAvailableFields,
  fieldIdToColumnAlias,
} from "@dashframe/engine";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type {
  CompiledInsight,
  DataTable,
  Field,
  Insight,
  UUID,
} from "@dashframe/types";
import { fieldEncoding } from "@dashframe/types";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxisSelectField } from "./AxisSelectField";

// ── Stubs ────────────────────────────────────────────────────────────────────

// Capture the options list passed to SelectField from inside AxisSelectField.
// We expose it via a module-level ref updated on each render call.
let capturedOptions: Array<{ label: string; value: string }> = [];
let capturedOnChange: (v: string) => void = () => {};

vi.mock("@dashframe/ui", () => ({
  SelectField: (props: {
    label?: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ label: string; value: string }>;
    placeholder?: string;
    onClear?: () => void;
    error?: string;
    labelAddon?: unknown;
  }) => {
    // Record what was passed in so assertions can inspect it.
    capturedOptions = props.options ?? [];
    capturedOnChange = props.onChange;
    return (
      <select
        data-testid="axis-select"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  },
}));

// Heavy deps with no relevant logic for these tests — stub out.
vi.mock("@/lib/utils/field-icons", () => ({
  getColumnIcon: () => null,
}));

vi.mock("@/lib/visualizations/axis-warnings", () => ({
  getColumnWarning: () => null,
  getRankedColumnOptions: (aliases: string[]) =>
    aliases.map((a) => ({ value: a, label: a, warning: null })),
}));

vi.mock("@/lib/visualizations/encoding-enforcer", () => ({
  getAxisSemanticLabel: () => undefined,
  getValidColumnsForChannel: (
    _axis: unknown,
    _chartType: unknown,
    cols: ColumnAnalysis[],
  ) => cols.map((c) => c.columnName),
  isColumnValidForChannel: () => ({ suitable: true }),
}));

vi.mock("@wystack/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipPrimitive: ({ render: r }: { render: React.ReactNode }) => r,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipTrigger: ({ render: r }: { render: React.ReactNode }) => r,
}));

vi.mock("@wystack/ui-icons", () => ({
  AlertCircleIcon: () => null,
  ArrowUpDownIcon: () => null,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ORDERS_TABLE_ID = "10101010-1010-1010-1010-101010101010" as UUID;
const ORDERS_DF_ID = "20202020-2020-2020-2020-202020202020" as UUID;
const USERS_TABLE_ID = "30303030-3030-3030-3030-303030303030" as UUID;
const USERS_DF_ID = "40404040-4040-4040-4040-404040404040" as UUID;
const DATA_SOURCE_ID = "33333333-3333-3333-3333-333333333333" as UUID;

const O_ID_FIELD: Field = {
  id: "a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0" as UUID,
  name: "Order ID",
  tableId: ORDERS_TABLE_ID,
  columnName: "id",
  type: "string",
};

const U_NAME_FIELD: Field = {
  id: "e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0" as UUID,
  name: "User Name",
  tableId: USERS_TABLE_ID,
  columnName: "name",
  type: "string",
};

const U_EMAIL_FIELD: Field = {
  id: "f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0" as UUID,
  name: "User Email",
  tableId: USERS_TABLE_ID,
  columnName: "email",
  type: "string",
};

const U_ID_FIELD: Field = {
  id: "d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0" as UUID,
  name: "User ID",
  tableId: USERS_TABLE_ID,
  columnName: "id",
  type: "string",
};

const ordersTable: DataTable = {
  id: ORDERS_TABLE_ID,
  name: "orders",
  dataSourceId: DATA_SOURCE_ID,
  table: "orders.csv",
  fields: [
    O_ID_FIELD,
    {
      id: "b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0" as UUID,
      name: "Created By",
      tableId: ORDERS_TABLE_ID,
      columnName: "created_by",
      type: "string",
    },
    {
      id: "c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0" as UUID,
      name: "Approved By",
      tableId: ORDERS_TABLE_ID,
      columnName: "approved_by",
      type: "string",
    },
  ],
  metrics: [],
  dataFrameId: ORDERS_DF_ID,
  createdAt: 0,
};

const usersTable: DataTable = {
  id: USERS_TABLE_ID,
  name: "users",
  dataSourceId: DATA_SOURCE_ID,
  table: "users.csv",
  fields: [U_ID_FIELD, U_NAME_FIELD, U_EMAIL_FIELD],
  metrics: [],
  dataFrameId: USERS_DF_ID,
  createdAt: 0,
};

const joinedTables = new Map([[USERS_TABLE_ID, usersTable]]);

const doubleJoinInsight: Pick<Insight, "joins"> = {
  joins: [
    {
      type: "inner",
      rightTableId: USERS_TABLE_ID,
      leftKey: "created_by",
      rightKey: "id",
    },
    {
      type: "inner",
      rightTableId: USERS_TABLE_ID,
      leftKey: "approved_by",
      rightKey: "id",
    },
  ],
};

// Build instance-aware fields the same way the real app does
// (buildInsightAvailableFields from @dashframe/engine).
const instanceAwareFields =
  buildInsightAvailableFields(ordersTable, joinedTables, doubleJoinInsight) ??
  [];

// j0 is the bare-UUID entry; j1 is the _j1 synthetic entry.
const j1NameId = `${U_NAME_FIELD.id}_j1` as UUID;

// Encoding values the picker must expose.
const J0_ENC = fieldEncoding(U_NAME_FIELD.id as UUID); // field:<uuid>
const J1_ENC = fieldEncoding(j1NameId); // field:<uuid>_j1

// Verify the test fixtures are valid before running assertions.
const j0Field = instanceAwareFields.find((f) => f.id === U_NAME_FIELD.id);
const j1Field = instanceAwareFields.find((f) => f.id === j1NameId);
if (!j0Field || !j1Field) {
  throw new Error(
    `Test fixture error: buildInsightAvailableFields did not return expected j0/j1 fields. ` +
      `ids found: ${instanceAwareFields.map((f) => f.id).join(", ")}`,
  );
}

// The compiledInsight only carries the base-table fields (as in the real app —
// compiledInsight.dimensions comes from the selectedFields of the bare insight,
// not the joined expansion).  AxisSelectField must merge in availableFields.
const baseCompiledInsight: CompiledInsight = {
  id: "ins-1" as UUID,
  name: "Test Insight",
  dimensions: [O_ID_FIELD],
  metrics: [],
};

// ColumnAnalysis entries simulate what analyzeView/DuckDB returns for a
// repeat-joined view.  The columnName carries the _j suffix DuckDB emits.
const j0Alias = fieldIdToColumnAlias(U_NAME_FIELD.id);
const j1Alias = `${fieldIdToColumnAlias(U_NAME_FIELD.id)}_j1`;

const columnAnalysis: ColumnAnalysis[] = [
  {
    columnName: fieldIdToColumnAlias(O_ID_FIELD.id),
    fieldId: O_ID_FIELD.id,
    semantic: "string",
    nullable: false,
  },
  // j0 instance — no fieldId (same as how analyzeView produces it for joined columns)
  {
    columnName: j0Alias,
    fieldId: undefined,
    semantic: "string",
    nullable: false,
  },
  // j1 instance — _j1 suffix
  {
    columnName: j1Alias,
    fieldId: undefined,
    semantic: "string",
    nullable: false,
  },
];

// Disambiguated display names (mirrors useInsightPagination.columnDisplayNames).
const columnDisplayNames: Record<string, string> = {
  [j0Alias]: "User Name (created_by)",
  [j1Alias]: "User Name (approved_by)",
};

// ── Shared render helper ──────────────────────────────────────────────────────

function renderAxisSelect(value = "") {
  return render(
    <AxisSelectField
      label="X Axis"
      value={value}
      onChange={vi.fn()}
      axis="x"
      chartType="barY"
      columnAnalysis={columnAnalysis}
      compiledInsight={baseCompiledInsight}
      availableFields={instanceAwareFields}
      columnDisplayNames={columnDisplayNames}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AxisSelectField — repeat-join picker (component render)", () => {
  beforeEach(() => {
    capturedOptions = [];
    capturedOnChange = () => {};
    vi.clearAllMocks();
  });

  it("exposes BOTH repeat-join instances as distinct options", () => {
    renderAxisSelect();

    const values = capturedOptions.map((o) => o.value);
    expect(values).toContain(J0_ENC);
    expect(values).toContain(J1_ENC);
    // They must be DISTINCT (not collapsed to the same encoding).
    expect(J0_ENC).not.toBe(J1_ENC);
  });

  it("gives each repeat-join instance a distinct human-readable label", () => {
    renderAxisSelect();

    const j0Opt = capturedOptions.find((o) => o.value === J0_ENC);
    const j1Opt = capturedOptions.find((o) => o.value === J1_ENC);

    expect(j0Opt).toBeDefined();
    expect(j1Opt).toBeDefined();

    // Labels must be distinct — user can tell the two instances apart.
    expect(j0Opt!.label).not.toBe(j1Opt!.label);

    // The disambiguation suffix comes from columnDisplayNames.
    expect(j0Opt!.label).toBe("User Name (created_by)");
    expect(j1Opt!.label).toBe("User Name (approved_by)");
  });

  it("selecting the second join instance emits the _j1 encoding", () => {
    const onChangeMock = vi.fn();
    render(
      <AxisSelectField
        label="X Axis"
        value=""
        onChange={onChangeMock}
        axis="x"
        chartType="barY"
        columnAnalysis={columnAnalysis}
        compiledInsight={baseCompiledInsight}
        availableFields={instanceAwareFields}
        columnDisplayNames={columnDisplayNames}
      />,
    );

    // Simulate the user selecting the j1 option via the stubbed select.
    capturedOnChange(J1_ENC);

    expect(onChangeMock).toHaveBeenCalledWith(J1_ENC);
    // Must NOT collapse to the bare-UUID encoding.
    expect(onChangeMock).not.toHaveBeenCalledWith(J0_ENC);
  });

  it("selecting the first join instance emits the bare-UUID encoding", () => {
    const onChangeMock = vi.fn();
    render(
      <AxisSelectField
        label="X Axis"
        value=""
        onChange={onChangeMock}
        axis="x"
        chartType="barY"
        columnAnalysis={columnAnalysis}
        compiledInsight={baseCompiledInsight}
        availableFields={instanceAwareFields}
        columnDisplayNames={columnDisplayNames}
      />,
    );

    capturedOnChange(J0_ENC);

    expect(onChangeMock).toHaveBeenCalledWith(J0_ENC);
  });

  it("single-join insight is unaffected — j0 option is present, no spurious j1", () => {
    const singleJoinInsight: Pick<Insight, "joins"> = {
      joins: [
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "created_by",
          rightKey: "id",
        },
      ],
    };
    const singleAwareFields =
      buildInsightAvailableFields(
        ordersTable,
        joinedTables,
        singleJoinInsight,
      ) ?? [];

    render(
      <AxisSelectField
        label="X Axis"
        value=""
        onChange={vi.fn()}
        axis="x"
        chartType="barY"
        columnAnalysis={[
          {
            columnName: fieldIdToColumnAlias(O_ID_FIELD.id),
            fieldId: O_ID_FIELD.id,
            semantic: "string",
            nullable: false,
          },
          {
            columnName: j0Alias,
            fieldId: undefined,
            semantic: "string",
            nullable: false,
          },
        ]}
        compiledInsight={baseCompiledInsight}
        availableFields={singleAwareFields}
      />,
    );

    const values = capturedOptions.map((o) => o.value);
    // j0 (bare UUID) must be present.
    expect(values).toContain(J0_ENC);
    // No _j1 instance should appear for a single join.
    expect(values).not.toContain(J1_ENC);
  });
});
