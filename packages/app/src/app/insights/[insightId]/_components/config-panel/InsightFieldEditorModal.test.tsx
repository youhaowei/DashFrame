import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InsightFieldEditorModal } from "./InsightFieldEditorModal";

const fields = [
  {
    id: "order-id",
    name: "order_id",
    displayName: "order_id",
    tableId: "orders",
    sourceTableId: "orders",
    type: "number",
  },
  {
    id: "customer-email",
    name: "customer_email",
    displayName: "customer_email",
    tableId: "orders",
    sourceTableId: "orders",
    type: "string",
    sensitivity: "sensitive",
    sensitivityReason: "Contains email addresses",
  },
  {
    id: "amount",
    name: "amount",
    displayName: "amount",
    tableId: "orders",
    sourceTableId: "orders",
    type: "number",
  },
] as CombinedField[];

describe("InsightFieldEditorModal", () => {
  it("renders the shared sensitivity marker only for sensitive fields", () => {
    render(
      <InsightFieldEditorModal
        isOpen
        onOpenChange={vi.fn()}
        availableFields={fields}
        baseTableId="orders"
        onSelect={vi.fn()}
      />,
    );

    const emailField = screen.getByRole("button", {
      name: /customer_email/i,
    });
    expect(within(emailField).getByText("Sensitive")).toBeTruthy();

    for (const fieldName of ["order_id", "amount"]) {
      const field = screen.getByRole("button", {
        name: new RegExp(`^${fieldName} `),
      });
      expect(within(field).queryByText(/sensitive|unclassified/i)).toBeNull();
    }
  });

  it("renders the shared suggestion marker for a likely-sensitive field only", () => {
    const unclassifiedFields = fields.map((field) =>
      field.id === "customer-email"
        ? { ...field, sensitivity: undefined, sensitivityReason: undefined }
        : field,
    );

    render(
      <InsightFieldEditorModal
        isOpen
        onOpenChange={vi.fn()}
        availableFields={unclassifiedFields}
        baseTableId="orders"
        onSelect={vi.fn()}
      />,
    );

    const emailField = screen.getByRole("button", {
      name: /customer_email/i,
    });
    expect(within(emailField).getByText("Likely sensitive")).toBeTruthy();

    for (const fieldName of ["order_id", "amount"]) {
      const field = screen.getByRole("button", {
        name: new RegExp(`^${fieldName} `),
      });
      expect(
        within(field).queryByText(/Likely sensitive|Unclassified/),
      ).toBeNull();
    }
  });

  it("renders no sensitivity badge for a cleared field", () => {
    const clearedFields = fields.map((field) =>
      field.id === "customer-email"
        ? { ...field, sensitivity: "cleared", sensitivityReason: undefined }
        : field,
    );

    render(
      <InsightFieldEditorModal
        isOpen
        onOpenChange={vi.fn()}
        availableFields={clearedFields}
        baseTableId="orders"
        onSelect={vi.fn()}
      />,
    );

    const emailField = screen.getByRole("button", {
      name: /customer_email/i,
    });
    expect(
      within(emailField).queryByText(/Sensitive|Likely sensitive|Unclassified/),
    ).toBeNull();
  });
});
