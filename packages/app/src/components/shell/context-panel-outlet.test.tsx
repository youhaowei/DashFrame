import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ContextPanelProvider,
  type ContextPanelSection,
  useContextPanelSection,
  useContextPanelSections,
} from "./context-panel-outlet";

function SectionBinder({ section }: { section: ContextPanelSection }) {
  useContextPanelSection(section);
  return null;
}

function RegisteredSections() {
  const sections = useContextPanelSections();
  // Render `content` as well as `title` so an update that silently retains
  // stale content cannot pass an order assertion.
  return (
    <output data-testid="sections">
      {sections.map(({ id, title, content }) => (
        <span key={id}>
          {title}
          {content}
        </span>
      ))}
    </output>
  );
}

const olderSection: ContextPanelSection = {
  id: "configuration",
  title: "Older section",
  content: null,
};

const newerSection: ContextPanelSection = {
  id: "configuration",
  title: "Newer section",
  content: null,
};

describe("useContextPanelSection", () => {
  it("does not let an older cleanup remove a newer section with the same id", () => {
    const { rerender } = render(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="older" section={olderSection} />
      </ContextPanelProvider>,
    );

    rerender(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="older" section={olderSection} />
        <SectionBinder key="newer" section={newerSection} />
      </ContextPanelProvider>,
    );
    expect(screen.getByTestId("sections").textContent).toBe("Newer section");

    rerender(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="newer" section={newerSection} />
      </ContextPanelProvider>,
    );

    expect(screen.getByTestId("sections").textContent).toBe("Newer section");
  });

  it("clears the section when its only owner unmounts", () => {
    const { rerender } = render(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="only" section={olderSection} />
      </ContextPanelProvider>,
    );
    expect(screen.getByTestId("sections").textContent).toBe("Older section");

    // Ownership must not make cleanup inert: with no newer owner to protect,
    // the last binder leaving has to drop the section rather than strand it.
    rerender(
      <ContextPanelProvider>
        <RegisteredSections />
      </ContextPanelProvider>,
    );

    expect(screen.getByTestId("sections").textContent).toBe("");
  });

  it("updates a section's content in place without reordering the panel", () => {
    const first: ContextPanelSection = {
      id: "first",
      title: "First",
      content: null,
    };
    const second: ContextPanelSection = {
      id: "second",
      title: "Second",
      content: null,
    };

    const { rerender } = render(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="first" section={first} />
        <SectionBinder key="second" section={second} />
      </ContextPanelProvider>,
    );
    expect(screen.getByTestId("sections").textContent).toBe("FirstSecond");

    // A fresh ReactNode identity for the first section is an update, not a
    // re-registration — it must not remove-and-append the section to the end.
    rerender(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder
          key="first"
          section={{ ...first, content: <span>changed</span> }}
        />
        <SectionBinder key="second" section={second} />
      </ContextPanelProvider>,
    );

    expect(screen.getByTestId("sections").textContent).toBe(
      "FirstchangedSecond",
    );
  });

  it("does not let a superseded owner reclaim a section on a late update", () => {
    const { rerender } = render(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="outgoing" section={olderSection} />
      </ContextPanelProvider>,
    );

    rerender(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="outgoing" section={olderSection} />
        <SectionBinder key="incoming" section={newerSection} />
      </ContextPanelProvider>,
    );
    expect(screen.getByTestId("sections").textContent).toBe("Newer section");

    // The outgoing binder's content resolves late while it is still mounted.
    // It no longer owns this id, so the update must be refused outright —
    // otherwise its unmount would clear the incoming section.
    rerender(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder
          key="outgoing"
          section={{ ...olderSection, content: <span>late</span> }}
        />
        <SectionBinder key="incoming" section={newerSection} />
      </ContextPanelProvider>,
    );
    expect(screen.getByTestId("sections").textContent).toBe("Newer section");

    rerender(
      <ContextPanelProvider>
        <RegisteredSections />
        <SectionBinder key="incoming" section={newerSection} />
      </ContextPanelProvider>,
    );
    expect(screen.getByTestId("sections").textContent).toBe("Newer section");
  });
});
