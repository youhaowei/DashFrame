import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import type { RemoteApiConnector } from "@dashframe/engine";

const { cardState, execute, mutate } = vi.hoisted(() => ({
  cardState: { onConnect: undefined as (() => Promise<void>) | undefined },
  execute: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("@/data/host", () => ({ requestHost: mutate }));
vi.mock("@/hooks/useConnectorForm", () => ({
  useConnectorForm: () => ({
    form: { Field: () => null },
    formFields: [],
    execute,
    isSubmitting: false,
    submitError: null,
  }),
}));
vi.mock("@/lib/oauth-authorization-target", () => ({
  createOAuthAuthorizationTarget: () => null,
}));
vi.mock("./ConnectorCard", () => ({
  ConnectorCard: ({ onConnect }: { onConnect: () => Promise<void> }) => {
    cardState.onConnect = onConnect;
    return null;
  },
}));

import {
  ConnectorCardWithForm,
  rejectOAuthSetupWithoutAuthorizationUrl,
} from "./ConnectorCardWithForm";

const oauthConnector = {
  id: "googleAnalytics",
  name: "Google Analytics",
  sourceType: "remote-api",
  authKind: "oauth",
} as RemoteApiConnector;

describe("rejectOAuthSetupWithoutAuthorizationUrl", () => {
  beforeEach(() => {
    cardState.onConnect = undefined;
    execute.mockReset();
    execute.mockImplementation(async (action: () => Promise<unknown>) => {
      try {
        return await action();
      } catch {
        return null;
      }
    });
    mutate.mockReset();
    mutate.mockResolvedValue(undefined);
  });

  it("holds onboarding before OAuth setup and releases it when setup fails", async () => {
    const order: string[] = [];
    const onActivityChange = vi.fn((active: boolean) => {
      order.push(`activity:${active}`);
    });
    mutate.mockImplementation(async (operation: string) => {
      order.push(operation);
      throw new Error("setup failed");
    });
    render(
      createElement(ConnectorCardWithForm, {
        connector: oauthConnector,
        onFileSelect: vi.fn(),
        onConnect: vi.fn(),
        onOAuthConnect: vi.fn(),
        onActivityChange,
      }),
    );

    await act(async () => {
      await cardState.onConnect?.();
    });

    expect(order.slice(0, 2)).toEqual(["activity:true", "startConnectorSetup"]);
    expect(onActivityChange).toHaveBeenLastCalledWith(false);
  });

  it("releases the OAuth onboarding hold when the polling card unmounts", async () => {
    let rejectStart: ((cause: Error) => void) | undefined;
    mutate.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectStart = reject;
        }),
    );
    const onActivityChange = vi.fn();
    const view = render(
      createElement(ConnectorCardWithForm, {
        connector: oauthConnector,
        onFileSelect: vi.fn(),
        onConnect: vi.fn(),
        onOAuthConnect: vi.fn(),
        onActivityChange,
      }),
    );

    const connect = cardState.onConnect?.();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onActivityChange).toHaveBeenCalledWith(true);

    view.unmount();
    expect(onActivityChange).toHaveBeenLastCalledWith(false);

    rejectStart?.(new Error("cancelled"));
    await act(async () => {
      await connect;
    });
  });

  it("cancels the issued setup session before reporting the missing URL", async () => {
    const close = vi.fn();

    await expect(
      rejectOAuthSetupWithoutAuthorizationUrl("session-1", {
        kind: "popup",
        open: vi.fn(),
        close,
      }),
    ).rejects.toThrow("Google authorization URL was not issued");

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0]?.[1]).toEqual({ sessionId: "session-1" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves the primary error when cancellation fails", async () => {
    mutate.mockRejectedValue(new Error("cleanup failed"));

    await expect(
      rejectOAuthSetupWithoutAuthorizationUrl("session-2", null),
    ).rejects.toThrow("Google authorization URL was not issued");
  });
});
