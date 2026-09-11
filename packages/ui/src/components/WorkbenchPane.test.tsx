import { fireEvent, render, screen } from "@testing-library/react";
import { TableIcon } from "@wystack/ui-react/icons";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  WorkbenchJumpBar,
  WorkbenchPaneSection,
  useWorkbenchPaneSections,
} from "./WorkbenchPane";

const SECTION_IDS = ["tables"] as const;

function Harness() {
  const pane = useWorkbenchPaneSections(SECTION_IDS);
  return (
    <>
      <WorkbenchJumpBar
        items={[{ id: "tables", label: "Tables", icon: TableIcon }]}
        onJump={(id) => pane.jumpToSection(id as "tables")}
        allCollapsed={pane.allCollapsed}
        onToggleAll={pane.toggleAll}
      />
      <WorkbenchPaneSection
        ref={pane.registerSection("tables")}
        title="Tables"
        icon={TableIcon}
        open={pane.openSections.tables}
        summary="orders, customers"
        onOpenChange={(open) => pane.setSectionOpen("tables", open)}
      >
        <p>Table settings</p>
      </WorkbenchPaneSection>
    </>
  );
}

describe("workbench pane sections", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("shows the summary when a section collapses", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(screen.getByText("orders, customers")).toBeTruthy();
    expect(screen.queryByText("Table settings")).toBeNull();
  });

  it("opens and scrolls to a collapsed section from the jump bar", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    fireEvent.click(screen.getByRole("button", { name: "Jump to Tables" }));
    expect(screen.getByText("Table settings")).toBeTruthy();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
