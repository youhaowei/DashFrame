import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantStore } from "@/lib/stores/assistant-store";

import { AssistantToggle } from "./AssistantToggle";

const { configsResult } = vi.hoisted(() => ({
  configsResult: {
    data: [] as Array<{ id: string }>,
    isLoading: false,
  },
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => {
      if (ref._path === "listAssistantProviderConfigs") return configsResult;
      return { data: undefined, isLoading: false };
    },
    useMutation: () => ({ mutateAsync: vi.fn() }),
  };
});

describe("AssistantToggle", () => {
  beforeEach(() => {
    configsResult.data = [];
    useAssistantStore.setState({ isOpen: false, isSetupOpen: false });
  });

  it("opens provider setup instead of an unusable rail when unconfigured", () => {
    render(<AssistantToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Set up assistant" }));

    expect(useAssistantStore.getState().isSetupOpen).toBe(true);
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("opens the assistant rail once a provider is configured", () => {
    configsResult.data = [{ id: "provider-1" }];
    render(<AssistantToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));

    expect(useAssistantStore.getState().isOpen).toBe(true);
    expect(useAssistantStore.getState().isSetupOpen).toBe(false);
  });
});
