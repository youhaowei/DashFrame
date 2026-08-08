import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ArtifactContextProvider,
  type ArtifactContextValue,
  useArtifactContext,
  useBindArtifact,
} from "./artifact-context";

function ArtifactBinder({ artifact }: { artifact: ArtifactContextValue }) {
  useBindArtifact(artifact);
  return null;
}

function BoundArtifact() {
  const artifact = useArtifactContext();
  return <output data-testid="artifact">{artifact?.title ?? "none"}</output>;
}

const olderArtifact: ArtifactContextValue = {
  kind: "dashboard",
  id: "older",
  title: "Older dashboard",
};

const newerArtifact: ArtifactContextValue = {
  kind: "dashboard",
  id: "newer",
  title: "Newer dashboard",
};

describe("useBindArtifact", () => {
  it("does not let an older cleanup clear a newer binding", () => {
    const { rerender } = render(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder key="older" artifact={olderArtifact} />
      </ArtifactContextProvider>,
    );

    rerender(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder key="older" artifact={olderArtifact} />
        <ArtifactBinder key="newer" artifact={newerArtifact} />
      </ArtifactContextProvider>,
    );
    expect(screen.getByTestId("artifact").textContent).toBe("Newer dashboard");

    rerender(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder key="newer" artifact={newerArtifact} />
      </ArtifactContextProvider>,
    );

    expect(screen.getByTestId("artifact").textContent).toBe("Newer dashboard");
  });

  it("clears the binding when its only owner unmounts", () => {
    const { rerender } = render(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder key="only" artifact={olderArtifact} />
      </ArtifactContextProvider>,
    );
    expect(screen.getByTestId("artifact").textContent).toBe("Older dashboard");

    // Ownership must not make cleanup inert: with no newer owner to protect,
    // leaving the surface has to release the assistant's binding rather than
    // strand it pointing at an artifact the user is no longer looking at.
    rerender(
      <ArtifactContextProvider>
        <BoundArtifact />
      </ArtifactContextProvider>,
    );

    expect(screen.getByTestId("artifact").textContent).toBe("none");
  });

  it("treats delimiter-colliding titles and subtitles as distinct bindings", () => {
    const { rerender } = render(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder
          artifact={{
            kind: "insight",
            id: "same-id",
            title: "a:b",
            subtitle: "c",
          }}
        />
      </ArtifactContextProvider>,
    );
    expect(screen.getByTestId("artifact").textContent).toBe("a:b");

    rerender(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder
          artifact={{
            kind: "insight",
            id: "same-id",
            title: "a",
            subtitle: "b:c",
          }}
        />
      </ArtifactContextProvider>,
    );

    expect(screen.getByTestId("artifact").textContent).toBe("a");
  });
});
