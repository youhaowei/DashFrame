import { useShellStore } from "@/lib/stores/shell-store";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { Workbench, WorkbenchPaneToggle, useWorkbenchPanes } from "./Workbench";

function Page({ artifactType }: { artifactType: string }) {
  const panes = useWorkbenchPanes(artifactType);
  return (
    <Workbench
      leftOpen={panes.leftOpen}
      rightOpen={panes.rightOpen}
      left={<button type="button">Config control</button>}
      right={<button type="button">Inspector control</button>}
    >
      <WorkbenchPaneToggle
        side="left"
        open={panes.leftOpen}
        paneName="Config"
        onToggle={panes.toggleLeft}
      />
      <WorkbenchPaneToggle
        side="right"
        open={panes.rightOpen}
        paneName="Inspector"
        onToggle={panes.toggleRight}
      />
    </Workbench>
  );
}

// Collapsed panes leave the accessibility tree, so `hidden: true` finds them.
const control = (name: string) =>
  screen.getByRole("button", { name, hidden: true });
const paneOf = (name: string) => control(name).closest("aside")!;

beforeEach(() => {
  useShellStore.setState({ workbenchPanes: {} });
});

describe("Workbench", () => {
  it("opens both panes by default", () => {
    render(<Page artifactType="insight" />);
    expect(screen.getByRole("button", { name: "Config control" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Inspector control" }),
    ).toBeTruthy();
    expect(paneOf("Config control").className).toContain("w-64");
    expect(paneOf("Inspector control").className).toContain("w-60");
  });

  it("collapses a pane out of reach and back", () => {
    render(<Page artifactType="insight" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Config pane" }),
    );
    const left = paneOf("Config control");
    expect(left.className).toContain("w-0");
    expect(left.hasAttribute("inert")).toBe(true);
    expect(left.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: "Config control" })).toBeNull();
    // The other pane is untouched.
    expect(paneOf("Inspector control").className).toContain("w-60");

    fireEvent.click(screen.getByRole("button", { name: "Expand Config pane" }));
    expect(paneOf("Config control").className).toContain("w-64");
    expect(paneOf("Config control").hasAttribute("inert")).toBe(false);
  });

  it("remembers collapsed panes per artifact type", () => {
    const { unmount } = render(<Page artifactType="insight" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Inspector pane" }),
    );
    unmount();

    // Another insight opens with the inspector still collapsed…
    const insight = render(<Page artifactType="insight" />);
    expect(paneOf("Inspector control").className).toContain("w-0");
    insight.unmount();

    // …while another kind of artifact keeps its own layout.
    render(<Page artifactType="data-source" />);
    expect(paneOf("Inspector control").className).toContain("w-60");
  });

  it("lets the page hide the inspector whatever was remembered", () => {
    render(
      <Workbench rightOpen={false} right={<span>Inspector</span>}>
        canvas
      </Workbench>,
    );
    expect(screen.getByText("Inspector").closest("aside")!.className).toContain(
      "w-0",
    );
  });

  it("renders no pane the page does not supply", () => {
    const { container } = render(<Workbench>canvas</Workbench>);
    expect(container.querySelectorAll("aside")).toHaveLength(0);
    expect(screen.getByText("canvas")).toBeTruthy();
  });
});
