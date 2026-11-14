import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import {
  ArtifactCard,
  ArtifactCollection,
  ArtifactEmptyState,
  ArtifactGrid,
  ArtifactRow,
  ArtifactRowGroups,
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

function PopulatedCollectionFilteredToNoMatches() {
  const [searchQuery, setSearchQuery] = useState("missing");

  return (
    <ArtifactCollection
      title="Drafts"
      itemCount={2}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search drafts..."
      searchLabel="Search drafts"
    >
      {searchQuery ? (
        <ArtifactEmptyState
          title="No drafts found"
          action={
            <button type="button" onClick={() => setSearchQuery("")}>
              Clear search
            </button>
          }
        />
      ) : (
        <ArtifactGrid>
          <ArtifactCard name="Alpha" />
          <ArtifactCard name="Beta" />
        </ArtifactGrid>
      )}
    </ArtifactCollection>
  );
}

describe("ArtifactCollection structure", () => {
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
    expect(document.activeElement).not.toBe(document.body);
    expect(collectionHeading.className).toContain("focus:outline-none");
    expect(collectionHeading.className).toContain("focus-visible:ring-2");
    expect(collectionHeading.className).toContain(
      "focus-visible:ring-neutral-ring",
    );
    expect(screen.queryByRole("textbox", { name: "Search drafts" })).toBeNull();
  });

  it("moves focus to search when clearing a no-match query in a populated collection", async () => {
    render(<PopulatedCollectionFilteredToNoMatches />);
    const clearSearch = screen.getByRole("button", { name: "Clear search" });
    clearSearch.focus();

    fireEvent.click(clearSearch);

    const searchInput = screen.getByRole("textbox", { name: "Search drafts" });
    await waitFor(() => expect(document.activeElement).toBe(searchInput));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("ArtifactRowGroups", () => {
  const renderRow = (
    name: string,
    { headingLevel }: { headingLevel: 2 | 3 },
  ) => (
    <ArtifactRow
      key={name}
      to={`/reports/${name}`}
      name={name}
      glyph={null}
      headingLevel={headingLevel}
    />
  );

  it("labels each group and collapses it from its label", () => {
    render(
      <ArtifactRowGroups
        groups={[
          { key: "today", label: "Today", items: ["Alpha"] },
          { key: "earlier", label: "Earlier", items: ["Beta", "Gamma"] },
        ]}
        renderRow={renderRow}
      />,
    );

    const earlier = screen.getByRole("button", { name: "Earlier 2" });
    expect(earlier.getAttribute("aria-expanded")).toBe("true");
    screen.getByRole("heading", { level: 3, name: "Beta" });

    fireEvent.click(earlier);

    expect(earlier.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("heading", { level: 3, name: "Beta" }),
    ).toBeNull();
    screen.getByRole("heading", { level: 3, name: "Alpha" });
  });
});
