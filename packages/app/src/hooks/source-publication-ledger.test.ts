import type { UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import {
  isAutomaticSourcePublication,
  isSelfPublishedSourceRevision,
  recordAutomaticSourcePublication,
} from "./source-publication-ledger";

function revision(frame: string, fetchedAt: number): string {
  return `table:table-1:${frame}:${fetchedAt}`;
}

function generation(frame: string, lastFetchedAt = 2) {
  return [
    {
      tableId: "table-1" as UUID,
      dataFrameId: frame as UUID,
      lastFetchedAt,
    },
  ];
}

describe("automatic source publication ledger", () => {
  it("matches only exact, unexpired publications in the same runtime", () => {
    const runtime = {};
    const anotherRuntime = {};
    recordAutomaticSourcePublication(
      runtime,
      revision("source-1", 1),
      generation("source-2"),
      100,
    );

    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("source-1", 1),
        revision("source-2", 2),
        101,
      ),
    ).toBe(true);
    expect(
      isAutomaticSourcePublication(
        anotherRuntime,
        revision("source-1", 1),
        revision("source-2", 2),
        101,
      ),
    ).toBe(false);
    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("source-1", 1),
        revision("external", 2),
        101,
      ),
    ).toBe(false);
    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("different-baseline", 1),
        revision("source-2", 2),
        101,
      ),
    ).toBe(false);
    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("source-1", 1),
        revision("source-2", 2),
        10_101,
      ),
    ).toBe(false);
  });

  it("retains only the latest bounded set for a runtime", () => {
    const runtime = {};
    for (let index = 0; index < 65; index += 1) {
      recordAutomaticSourcePublication(
        runtime,
        revision(`before-${index}`, index),
        generation(`after-${index}`, index + 1),
        100,
      );
    }

    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("before-0", 0),
        revision("after-0", 1),
        101,
      ),
    ).toBe(false);
    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("before-64", 64),
        revision("after-64", 65),
        101,
      ),
    ).toBe(true);
  });

  it("recognizes a coalesced chain of automatic source publications", () => {
    const runtime = {};
    recordAutomaticSourcePublication(
      runtime,
      revision("source-1", 1),
      generation("source-2"),
      100,
    );
    recordAutomaticSourcePublication(
      runtime,
      revision("source-2", 2),
      generation("source-3", 3),
      101,
    );

    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("source-1", 1),
        revision("source-3", 3),
        102,
      ),
    ).toBe(true);
    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("source-1", 1),
        revision("external", 3),
        102,
      ),
    ).toBe(false);
  });

  it("recognizes concurrent automatic publications from the same baseline", () => {
    const runtime = {};
    recordAutomaticSourcePublication(
      runtime,
      revision("source-1", 1),
      generation("source-2"),
      100,
    );
    recordAutomaticSourcePublication(
      runtime,
      revision("source-1", 1),
      generation("source-3", 3),
      101,
    );

    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("source-2", 2),
        revision("source-3", 3),
        102,
      ),
    ).toBe(true);
    expect(
      isAutomaticSourcePublication(
        runtime,
        revision("manual", 2),
        revision("source-3", 3),
        102,
      ),
    ).toBe(false);
  });
});

// RefreshDataTable can select any retained frame, stamping a new lastFetchedAt.
describe("manual retained-frame refreshes", () => {
  it.each(["source-1", "source-2", "source-3"])(
    "does not suppress a manual refresh to %s after concurrent publications",
    (frame) => {
      const runtime = {};
      recordAutomaticSourcePublication(
        runtime,
        revision("source-1", 1),
        generation("source-2", 2),
        100,
      );
      recordAutomaticSourcePublication(
        runtime,
        revision("source-1", 1),
        generation("source-3", 3),
        101,
      );
      expect(
        isAutomaticSourcePublication(
          runtime,
          revision("source-3", 3),
          revision(frame, 4),
          102,
        ),
      ).toBe(false);
    },
  );
});

describe("self publication identity", () => {
  it("requires the source publication timestamp even when the frame matches", () => {
    expect(
      isSelfPublishedSourceRevision(
        revision("source-1", 1),
        revision("source-2", 2),
        generation("source-2", 2),
      ),
    ).toBe(true);
    expect(
      isSelfPublishedSourceRevision(
        revision("source-1", 1),
        revision("source-2", 3),
        generation("source-2", 2),
      ),
    ).toBe(false);
  });
});
