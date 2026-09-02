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
  it("uses the shell's main landmark and gives every card a heading", () => {
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
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    screen.getByRole("heading", { level: 3, name: "Revenue" });
    screen.getByRole("heading", { level: 3, name: "Orders" });
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

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1, name: "Drafts" }),
      ),
    );
    expect(screen.queryByRole("textbox", { name: "Search drafts" })).toBeNull();
  });
});
