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
  const renderRow = (name: string, headingLevel: 2 | 3) => (
    <ArtifactRow
      key={name}
      to={`/reports/${name}`}
      name={name}
      glyph={null}
      headingLevel={headingLevel}
    />
  );

  it("renders one group as a flat list without its label", () => {
    render(
      <ArtifactRowGroups
        groups={[{ key: "today", label: "Today", items: ["Alpha", "Beta"] }]}
        renderRow={renderRow}
      />,
    );

    expect(screen.queryByRole("button", { name: /Today/ })).toBeNull();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Alpha", "Beta"]);
  });

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

describe("ArtifactCollection view toggle", () => {
  function renderCollection(itemCount: number, onViewChange = vi.fn()) {
    render(
      <ArtifactCollection
        title="Reports"
        count={itemCount}
        itemCount={itemCount}
        searchQuery=""
        onSearchQueryChange={() => {}}
        searchPlaceholder="Search reports..."
        searchLabel="Search reports"
        view="grid"
        onViewChange={onViewChange}
      >
        {null}
      </ArtifactCollection>,
    );
    return onViewChange;
  }

  it("switches to the list view", () => {
    const onViewChange = renderCollection(3);

    fireEvent.click(screen.getByRole("tab", { name: "List view" }));

    expect(onViewChange).toHaveBeenCalledWith("list");
  });

  it("hides the toggle when there is nothing to show", () => {
    renderCollection(0);

    expect(screen.queryByRole("tab", { name: "List view" })).toBeNull();
  });
});
