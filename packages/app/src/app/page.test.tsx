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

function mockProjectQueries(values: {
  dashboards?: unknown[];
  visualizations?: unknown[];
  insights?: unknown[];
  dataSources?: unknown[];
  draftCount?: number;
}) {
  mockUseQuery.mockImplementation(({ _path }: { _path: string }) => {
    if (_path === "listDashboards") {
      return { data: values.dashboards ?? [], isLoading: false };
    }
    if (_path === "listVisualizations") {
      return { data: values.visualizations ?? [], isLoading: false };
    }
    if (_path === "listInsights") {
      return { data: values.insights ?? [], isLoading: false };
    }
    if (_path === "listDataSources") {
      return { data: values.dataSources ?? [], isLoading: false };
    }
    if (_path === "listDraftCount") {
      return { data: values.draftCount ?? 0, isLoading: false };
    }
    return { data: [], isLoading: false };
  });
}

describe("HomePage report entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps empty projects on the onboarding flow", () => {
    mockProjectQueries({});

    render(<HomePage />);

    expect(screen.getByText("Project onboarding")).not.toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("routes populated projects through Reports without rendering legacy peers", async () => {
    mockProjectQueries({ visualizations: [{ id: "visualization-1" }] });

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
    mockProjectQueries({ dashboards: [{ id: "report-1" }] });

    render(<HomePage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards",
        replace: true,
      }),
    );
  });

  it("treats draft-only workspaces as populated projects", async () => {
    mockProjectQueries({ draftCount: 1 });

    render(<HomePage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards",
        replace: true,
      }),
    );
  });
});
