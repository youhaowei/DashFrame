import type {
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";
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

const googleConnector = {
  id: "googleAnalytics",
  name: "Google Analytics 4",
  sourceType: "remote-api",
  icon: "",
  authKind: "oauth",
  getFormFields: () => [],
  validate: () => ({ valid: true }),
} as unknown as RemoteApiConnector;

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

describe("ConnectorCard sign-in link", () => {
  it("offers the sign-in page as a link when no window opened for it", () => {
    const { rerender } = render(
      <ConnectorCard connector={googleConnector} expanded />,
    );
    expect(screen.queryByRole("link")).toBeNull();

    rerender(
      <ConnectorCard
        connector={googleConnector}
        expanded
        isLoading
        signInUrl="https://accounts.google.com/auth"
      />,
    );

    screen.getByRole("button", { name: "Waiting for Google..." });
    const link = screen.getByRole("link", { name: "Open Google sign-in" });
    expect(link.getAttribute("href")).toBe("https://accounts.google.com/auth");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("ConnectorCard unavailable setup", () => {
  it("disables connecting and says why", () => {
    const oauthConnector = {
      id: "googleAnalytics",
      name: "Google Analytics",
      description: "",
      sourceType: "remote-api",
      icon: "",
      authKind: "oauth",
    } as unknown as FileSourceConnector;

    render(
      <ConnectorCard
        connector={oauthConnector}
        expanded
        onConnect={vi.fn()}
        unavailableReason="Google sign-in isn't set up on this server."
      />,
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Google sign-in isn't set up on this server."),
    ).not.toBeNull();
  });
});
