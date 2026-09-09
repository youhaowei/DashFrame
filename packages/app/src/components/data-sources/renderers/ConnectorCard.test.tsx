import type { FileSourceConnector } from "@dashframe/engine";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
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

    render(
      <ConnectorCard
        connector={connector}
        expanded
        onFileSelect={onFileSelect}
      />,
    );

    const input = screen.getByLabelText("Select CSV file");
    await user.upload(input, file);

    expect(onFileSelect).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");

    await user.upload(input, file);

    expect(onFileSelect).toHaveBeenCalledTimes(2);
    expect(onFileSelect).toHaveBeenLastCalledWith(file);
  });
});

describe("ConnectorCard disclosure", () => {
  it("keeps the setup form closed until the header is opened", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    const { rerender } = render(
      <ConnectorCard connector={connector} onToggle={onToggle} />,
    );

    // Collapsed: the row states what the connector is, and nothing else.
    expect(screen.queryByLabelText("Select CSV file")).toBeNull();
    const header = screen.getByRole("button", { name: /csv file/i });
    expect(header.getAttribute("aria-expanded")).toBe("false");

    await user.click(header);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ConnectorCard connector={connector} expanded onToggle={onToggle} />,
    );

    expect(screen.getByLabelText("Select CSV file")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /csv file/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("renders a static row when there is no toggle handler", () => {
    render(<ConnectorCard connector={connector} expanded />);

    // The panel drops `onToggle` once this connector has been picked: the row
    // still says what is being set up, but it is no longer a choice.
    expect(screen.queryByRole("button", { name: /csv file/i })).toBeNull();
    expect(screen.getByText("CSV file")).not.toBeNull();
    expect(screen.getByLabelText("Select CSV file")).not.toBeNull();
  });
});
