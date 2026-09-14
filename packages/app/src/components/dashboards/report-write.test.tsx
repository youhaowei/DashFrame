import { nativeMutationMock } from "@/test/native-query-fixture";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  draftBatch: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mocks.draftBatch })),
}));

import {
  ReportDraftProvider,
  useReportDraft,
  useReportWrite,
} from "./report-write";

function command(itemId: string) {
  return {
    path: "removeDashboardItemCmd",
    args: { dashboardId: "report", itemId },
  };
}

describe("ReportDraftProvider", () => {
  it("creates the draft on the first write and appends later writes to it", async () => {
    let finishFirst: (value: unknown) => void = () => {};
    mocks.draftBatch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue({ draftId: "draft-new", results: [] });
    const onDraftCreated = vi.fn();
    let draft: ReturnType<typeof useReportDraft> = null;
    function Probe() {
      draft = useReportDraft();
      return null;
    }
    render(
      <ReportDraftProvider draftId={undefined} onDraftCreated={onDraftCreated}>
        <Probe />
      </ReportDraftProvider>,
    );

    const first = draft!.write({ commands: [command("a")] as never });
    const second = draft!.write({ commands: [command("b")] as never });
    const settled = draft!.settle();
    await vi.waitFor(() => expect(mocks.draftBatch).toHaveBeenCalledTimes(1));
    // The second write waits for the first, so it can't open its own draft.
    expect(mocks.draftBatch).toHaveBeenCalledWith({
      commands: [command("a")],
    });

    finishFirst({ draftId: "draft-new", results: [] });
    await Promise.all([first, second]);

    expect(mocks.draftBatch).toHaveBeenLastCalledWith({
      commands: [command("b")],
      draftId: "draft-new",
    });
    expect(onDraftCreated).toHaveBeenCalledTimes(1);
    expect(onDraftCreated).toHaveBeenCalledWith("draft-new");
    await expect(settled).resolves.toBe("draft-new");
  });

  it("rejects writes outside the edit page instead of saving them directly", async () => {
    let write: ReturnType<typeof useReportWrite> | undefined;
    function Probe() {
      write = useReportWrite();
      return null;
    }
    render(<Probe />);

    await expect(write!({ commands: [] })).rejects.toThrow(
      "ReportDraftProvider",
    );
  });
});
