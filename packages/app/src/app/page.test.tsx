import { nativeQueryMock } from "@/test/native-query-fixture";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  OnboardingView: ({
    onActivityChange,
  }: {
    onActivityChange?: (active: boolean) => void;
  }) => (
    <div>
      Project onboarding
      <button onClick={() => onActivityChange?.(true)}>Start connection</button>
    </div>
  ),
}));

vi.mock("@/components/drafts/DraftListItem", () => ({
  DraftListItem: () => <div>Draft</div>,
}));

import HomePage from "./page";

function mockProjectPresence(values: {
  present?: boolean;
  isLoading?: boolean;
  isError?: boolean;
}) {
  mockUseQuery.mockImplementation(({ _path }: { _path: string }) => {
    if (_path !== "workspaceArtifactPresence") {
      throw new Error(`Unexpected query: ${_path}`);
    }
    if (values.isError) {
      return { isError: true, error: new Error("presence failed") };
    }
    return {
      data: values.present ?? false,
      isLoading: values.isLoading ?? false,
    };
  });
}

describe("HomePage report entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps empty projects on the onboarding flow", () => {
    mockProjectPresence({});

    render(<HomePage />);

    expect(screen.getByText("Project onboarding")).not.toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("routes populated projects through Reports without rendering legacy peers", async () => {
    mockProjectPresence({ present: true });

    render(<HomePage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards",
        replace: true,
      }),
    );
    expect(screen.queryByText("Project onboarding")).toBeNull();
  });

  it("treats a report without saved views as a populated project", async () => {
    mockProjectPresence({ present: true });

    render(<HomePage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards",
        replace: true,
      }),
    );
  });

  it("treats draft-only workspaces as populated projects", async () => {
    mockProjectPresence({ present: true });

    render(<HomePage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards",
        replace: true,
      }),
    );
  });

  it("does not treat a failed presence query as a confirmed-empty project", () => {
    mockProjectPresence({ isError: true });

    render(<HomePage />);

    expect(screen.queryByText("Project onboarding")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't determine whether this project is empty",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("keeps onboarding mounted while the first connection is active", () => {
    const values: Parameters<typeof mockProjectPresence>[0] = {};
    mockProjectPresence(values);
    const { rerender } = render(<HomePage />);

    fireEvent.click(screen.getByRole("button", { name: "Start connection" }));
    values.present = true;
    rerender(<HomePage />);

    expect(screen.getByText("Project onboarding")).not.toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("routes a concurrently created artifact after clear reloads with a fresh client", async () => {
    mockProjectPresence({ present: true });
    render(<HomePage />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards",
        replace: true,
      }),
    );
  });
});
