/**
 * Contract tests for sensitivity badge visibility in the insight field picker.
 *
 * The field picker (InsightFieldEditorModal / FieldOption) must show privacy
 * signals at the point of use — the moment a user decides whether to include a
 * field in an analysis. These tests verify that contract without end-to-end
 * dialog machinery.
 *
 * Contract:
 *   - sensitive field → "Sensitive" badge rendered at-rest
 *   - unclassified field → "Unclassified" badge rendered at-rest
 *   - cleared field → no sensitivity badge rendered
 */
import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal stubs for external UI primitives so the test runs without CSS
// processing or icon font loading.
// ---------------------------------------------------------------------------

vi.mock("@wystack/ui-icons", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/ui-icons")>();
  return {
    ...actual,
    DatabaseIcon: () => null,
    NumberTypeIcon: () => null,
    SearchIcon: () => null,
  };
});

vi.mock("@wystack/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/ui")>();
  return {
    ...actual,
    // Render Dialog children directly so FieldOption is in the DOM without
    // needing a portal or body-level mount.
    Dialog: ({
      children,
      open,
    }: {
      children: React.ReactNode;
      open: boolean;
    }) => (open ? <div data-testid="dialog">{children}</div> : null),
    DialogContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-content">{children}</div>
    ),
    DialogHeader: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
  };
});

import { InsightFieldEditorModal } from "./InsightFieldEditorModal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<CombinedField> = {}): CombinedField {
  return {
    id: "f1",
    name: "customer_email",
    displayName: "customer_email",
    type: "string",
    sourceTableId: "tbl1",
    sensitivity: undefined,
    sensitivityReason: undefined,
    sensitivitySource: undefined,
    columnName: undefined,
    ...overrides,
  } as CombinedField;
}

function renderPicker(fields: CombinedField[]) {
  render(
    <InsightFieldEditorModal
      isOpen={true}
      onOpenChange={vi.fn()}
      availableFields={fields}
      baseTableId="tbl1"
      onSelect={vi.fn()}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InsightFieldEditorModal: sensitivity badge at-rest visibility", () => {
  it("shows 'Sensitive' badge for a sensitive field without hover or expand", () => {
    renderPicker([
      makeField({
        sensitivity: "sensitive",
        sensitivityReason: "contains PII",
      }),
    ]);

    expect(screen.getByText("Sensitive")).toBeTruthy();
  });

  it("shows 'Unclassified' badge for a field with no sensitivity set", () => {
    renderPicker([makeField({ sensitivity: undefined })]);

    expect(screen.getByText("Unclassified")).toBeTruthy();
  });

  it("shows 'Unclassified' badge for a field explicitly marked unclassified", () => {
    renderPicker([makeField({ sensitivity: "unclassified" })]);

    expect(screen.getByText("Unclassified")).toBeTruthy();
  });

  it("does not show any sensitivity badge for a cleared field", () => {
    renderPicker([makeField({ sensitivity: "cleared" })]);

    expect(screen.queryByText("Sensitive")).toBeNull();
    expect(screen.queryByText("Unclassified")).toBeNull();
    expect(screen.queryByText("Likely sensitive")).toBeNull();
  });
});
