import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockDiscardDraft, mockUseQuery } = vi.hoisted(() => ({
  mockDiscardDraft: vi.fn(),
  mockUseQuery: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) =>
    mockUseQuery(ref),
  ),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockDiscardDraft })),
}));

import DraftsPage from "./page";

describe("DraftsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ isPending: true });
  });

  it("keeps search available without showing a false count while drafts load", () => {
    render(<DraftsPage />);

    expect(screen.queryByText(/^0 drafts$/)).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search drafts" }),
    ).not.toBeNull();
  });
});
