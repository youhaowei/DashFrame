import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type WyStackClient, WyStackProvider } from "@wystack/client";
import { type FC, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantStore } from "@/lib/stores/assistant-store";

import { AssistantToggle } from "./AssistantToggle";

function makeClient(query: () => Promise<unknown>): WyStackClient {
  return {
    url: "https://test",
    prefix: "/api",
    query: vi.fn(query) as WyStackClient["query"],
    mutate: vi.fn(),
    ws: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn(() => false),
      call: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as WyStackClient["ws"],
  };
}

function makeWrapper(client: WyStackClient): FC<{ children: ReactNode }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        <WyStackProvider client={client}>{children}</WyStackProvider>
      </QueryClientProvider>
    );
  };
}

describe("AssistantToggle", () => {
  beforeEach(() => {
    useAssistantStore.setState({ isOpen: false, isSetupOpen: false });
  });

  it("opens provider setup instead of an unusable rail when unconfigured", async () => {
    const client = makeClient(async () => []);
    render(<AssistantToggle />, { wrapper: makeWrapper(client) });

    const button = await screen.findByRole("button", {
      name: "Set up assistant",
    });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(button);

    expect(useAssistantStore.getState().isSetupOpen).toBe(true);
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("opens the assistant rail once a provider is configured", async () => {
    const client = makeClient(async () => [{ id: "provider-1" }]);
    render(<AssistantToggle />, { wrapper: makeWrapper(client) });

    const button = await screen.findByRole("button", {
      name: "Open assistant",
    });
    fireEvent.click(button);

    expect(useAssistantStore.getState().isOpen).toBe(true);
    expect(useAssistantStore.getState().isSetupOpen).toBe(false);
  });

  it("stays reachable and retries, without opening a rail it cannot fill, after the config query fails", async () => {
    const query = vi.fn(() => Promise.reject(new Error("offline")));
    const client = makeClient(query);
    render(<AssistantToggle />, { wrapper: makeWrapper(client) });

    const button = await screen.findByRole("button", {
      name: "Retry assistant configuration",
    });
    // Reachable: the control is live rather than disabled forever, which is
    // what the silent lockout looked like.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    // With nothing cached we cannot know whether a provider exists, so neither
    // the rail nor the setup dialog is honest to present — retry is the whole
    // action. Opening either would trade a silent lockout for a broken surface.
    expect(useAssistantStore.getState().isOpen).toBe(false);
    expect(useAssistantStore.getState().isSetupOpen).toBe(false);
  });

  it("can still hide an open rail while a refetch is failing", async () => {
    let settled = false;
    const query = vi.fn(() =>
      settled
        ? Promise.reject(new Error("offline"))
        : Promise.resolve([{ id: "provider-1" }]),
    );
    const client = makeClient(query);
    render(<AssistantToggle />, { wrapper: makeWrapper(client) });

    fireEvent.click(
      await screen.findByRole("button", { name: "Open assistant" }),
    );
    expect(useAssistantStore.getState().isOpen).toBe(true);

    // A later refetch fails, but the rows already fetched are still shown, so
    // the control must keep behaving as a plain hide/show rather than turning
    // into a retry-only button the user cannot close the rail with.
    settled = true;
    const hide = await screen.findByRole("button", { name: "Hide assistant" });
    fireEvent.click(hide);

    expect(useAssistantStore.getState().isOpen).toBe(false);
  });
});
