import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

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

  it("does not let a superseded surface reclaim the binding on a late update", () => {
    const { rerender } = render(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder key="outgoing" artifact={olderArtifact} />
      </ArtifactContextProvider>,
    );

    // The incoming surface mounts and takes the binding.
    rerender(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder key="outgoing" artifact={olderArtifact} />
        <ArtifactBinder key="incoming" artifact={newerArtifact} />
      </ArtifactContextProvider>,
    );
    expect(screen.getByTestId("artifact").textContent).toBe("Newer dashboard");

    // The outgoing surface's own query resolves late and changes its artifact
    // while it is still mounted. That is an update, not a claim — it must not
    // take the binding back from the surface the user is actually looking at.
    rerender(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder
          key="outgoing"
          artifact={{ ...olderArtifact, title: "Older dashboard (loaded)" }}
        />
        <ArtifactBinder key="incoming" artifact={newerArtifact} />
      </ArtifactContextProvider>,
    );
    expect(screen.getByTestId("artifact").textContent).toBe("Newer dashboard");

    // ...and when it finally unmounts it must not clear the incoming binding,
    // which would leave the assistant empty on a live surface.
    rerender(
      <ArtifactContextProvider>
        <BoundArtifact />
        <ArtifactBinder key="incoming" artifact={newerArtifact} />
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
