import { nativeQueryMock } from "@/test/native-query-fixture";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockNavigate, mockUseQuery } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseQuery: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) =>
    mockUseQuery(ref),
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("./_components/OnboardingView", () => ({
  OnboardingView: () => <div>Project onboarding</div>,
}));

vi.mock("@/components/drafts/DraftListItem", () => ({
  DraftListItem: () => <div>Draft</div>,
}));

import HomePage from "./page";

describe("HomePage report entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps empty projects on the onboarding flow", () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false });

    render(<HomePage />);

    expect(screen.getByText("Project onboarding")).not.toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("routes populated projects through Reports without rendering legacy peers", async () => {
    mockUseQuery.mockImplementation(({ _path }: { _path: string }) => ({
      data: _path === "listVisualizations" ? [{ id: "visualization-1" }] : [],
      isLoading: false,
    }));

    render(<HomePage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards",
        replace: true,
      }),
    );
    expect(screen.queryByText("Project onboarding")).toBeNull();
  });
});
