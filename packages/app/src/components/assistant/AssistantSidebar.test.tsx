import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useAssistantStore } from "@/lib/stores/assistant-store";

import { AssistantSidebar } from "./AssistantSidebar";

const { runAssistantPrompt } = vi.hoisted(() => ({
  runAssistantPrompt: vi.fn(),
}));

vi.mock("@/data", () => ({
  runAssistantPrompt,
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listAssistantProviderCatalog") {
      return { data: [], isLoading: false };
    }
    if (ref._path === "listAssistantProviderConfigs") {
      return { data: [], isLoading: false };
    }
    return { data: undefined, isLoading: false };
  }),
  useMutation: nativeMutationMock(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => {
    if (ref._path === "listAssistantProviderCatalog") {
      return { data: [], isLoading: false };
    }
    if (ref._path === "listAssistantProviderConfigs") {
      return { data: [], isLoading: false };
    }
    return { data: undefined, isLoading: false };
  }),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: vi.fn() })),
}));

describe("AssistantSidebar", () => {
  beforeEach(() => {
    runAssistantPrompt.mockReset();
    useAssistantStore.setState({
      isOpen: true,
      pendingDraftId: null,
      runStatus: "idle",
      activeDraftId: null,
      selectedProviderConfigId: null,
      selectedModelId: null,
      turns: [],
      streamingText: "",
      error: null,
    });
  });

  it("blocks submission when no provider and model are configured", () => {
    render(<AssistantSidebar />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the assistant" }),
      {
        target: { value: "hello" },
      },
    );

    const send = screen.getByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);

    expect(runAssistantPrompt).not.toHaveBeenCalled();
    expect(useAssistantStore.getState().turns).toEqual([]);
  });
});
