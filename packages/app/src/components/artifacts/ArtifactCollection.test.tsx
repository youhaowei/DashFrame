import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import {
  ArtifactCard,
  ArtifactCollection,
  ArtifactEmptyState,
  ArtifactGrid,
} from "./ArtifactCollection";

function SearchThatEmptied() {
  const [searchQuery, setSearchQuery] = useState("missing");

  return (
    <ArtifactCollection
      title="Drafts"
      itemCount={0}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search drafts..."
      searchLabel="Search drafts"
    >
      <ArtifactEmptyState
        title={searchQuery ? "No drafts found" : "No drafts yet"}
        action={
          searchQuery ? (
            <button type="button" onClick={() => setSearchQuery("")}>
              Clear search
            </button>
          ) : undefined
        }
      />
    </ArtifactCollection>
  );
}

describe("ArtifactCollection structure", () => {
  function headingLevels() {
    return screen
      .getAllByRole("heading")
      .map((heading) => Number(heading.tagName.slice(1)));
  }

  function expectNoSkippedHeadingLevels(levels: number[]) {
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1);
    }
  }

  it("uses the shell's main landmark and gives ungrouped cards level-two headings", () => {
    render(
      <ArtifactCollection
        title="Insights"
        itemCount={2}
        searchQuery=""
        onSearchQueryChange={() => {}}
        searchPlaceholder="Search insights..."
        searchLabel="Search insights"
      >
        <ArtifactGrid>
          <ArtifactCard name="Revenue" />
          <ArtifactCard name="Orders" />
        </ArtifactGrid>
      </ArtifactCollection>,
    );

    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
    const revenueHeading = screen.getByRole("heading", {
      level: 2,
      name: "Revenue",
    });
    screen.getByRole("heading", { level: 2, name: "Orders" });
    expect(revenueHeading.parentElement?.tagName).toBe("DIV");
    expectNoSkippedHeadingLevels(headingLevels());
  });

  it("allows grouped cards to use level-three headings without skipping a level", () => {
    render(
      <ArtifactCollection
        title="Insights"
        itemCount={1}
        searchQuery=""
        onSearchQueryChange={() => {}}
        searchPlaceholder="Search insights..."
        searchLabel="Search insights"
      >
        <section>
          <h2>Drafts</h2>
          <ArtifactCard name="Revenue" headingLevel={3} />
        </section>
      </ArtifactCollection>,
    );

    screen.getByRole("heading", { level: 3, name: "Revenue" });
    expectNoSkippedHeadingLevels(headingLevels());
  });

  it("uses a level-two empty-state heading under the page title", () => {
    render(<ArtifactEmptyState title="No insights yet" />);

    screen.getByRole("heading", { level: 2, name: "No insights yet" });
  });

  it("moves focus to the collection heading when clearing search unmounts the controls", async () => {
    render(<SearchThatEmptied />);
    const clearSearch = screen.getByRole("button", { name: "Clear search" });
    clearSearch.focus();

    fireEvent.click(clearSearch);

    const collectionHeading = screen.getByRole("heading", {
      level: 1,
      name: "Drafts",
    });
    await waitFor(() => expect(document.activeElement).toBe(collectionHeading));
    expect(collectionHeading.className).toContain("focus:outline-none");
    expect(collectionHeading.className).toContain("focus-visible:ring-2");
    expect(collectionHeading.className).toContain(
      "focus-visible:ring-neutral-ring",
    );
    expect(screen.queryByRole("textbox", { name: "Search drafts" })).toBeNull();
  });
});
