import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantStore } from "@/lib/stores/assistant-store";

import { AssistantSidebar } from "./AssistantSidebar";

const { runAssistantPrompt } = vi.hoisted(() => ({
  runAssistantPrompt: vi.fn(),
}));

vi.mock("@/data", () => ({
  runAssistantPrompt,
  useAssistantProviderCatalog: () => ({ data: [], isLoading: false }),
  useAssistantProviderConfigs: () => ({ data: [], isLoading: false }),
  useAssistantProviderConfigMutations: () => ({
    save: vi.fn(),
    setDefaultModel: vi.fn(),
  }),
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
