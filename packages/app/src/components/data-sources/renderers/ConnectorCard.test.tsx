import type { FileSourceConnector } from "@dashframe/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectorCard } from "./ConnectorCard";

vi.mock("./ConnectorIcon", () => ({
  ConnectorIcon: () => null,
}));

const connector = {
  id: "csv",
  name: "CSV file",
  description: "Upload a CSV file.",
  sourceType: "file",
  icon: "",
  authKind: "form",
  accept: ".csv",
  getFormFields: () => [],
  validate: () => ({ valid: true }),
  parse: vi.fn(),
} as FileSourceConnector;

describe("ConnectorCard file input", () => {
  it("clears the selected file so the same file can be picked again", async () => {
    const onFileSelect = vi.fn();
    const user = userEvent.setup();
    const file = new File(["name\nAda"], "people.csv", {
      type: "text/csv",
    });

    render(<ConnectorCard connector={connector} onFileSelect={onFileSelect} />);

    const input = screen.getByLabelText("Select CSV file");
    await user.upload(input, file);

    expect(onFileSelect).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");

    await user.upload(input, file);

    expect(onFileSelect).toHaveBeenCalledTimes(2);
    expect(onFileSelect).toHaveBeenLastCalledWith(file);
  });
});
