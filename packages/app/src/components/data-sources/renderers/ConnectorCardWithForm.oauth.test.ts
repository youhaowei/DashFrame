import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import type {
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";

const { cardState, execute, mutate } = vi.hoisted(() => ({
  cardState: {
    onConnect: undefined as (() => Promise<void>) | undefined,
    onFileSelect: undefined as ((file: File) => Promise<void>) | undefined,
  },
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
  ConnectorCard: ({
    onConnect,
    onFileSelect,
  }: {
    onConnect: () => Promise<void>;
    onFileSelect: (file: File) => Promise<void>;
  }) => {
    cardState.onConnect = onConnect;
    cardState.onFileSelect = onFileSelect;
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

const fileConnector = {
  id: "local",
  name: "Local file",
  sourceType: "file",
  authKind: "none",
} as FileSourceConnector;

describe("rejectOAuthSetupWithoutAuthorizationUrl", () => {
  beforeEach(() => {
    cardState.onConnect = undefined;
    cardState.onFileSelect = undefined;
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

  it("does not start connector work when the ownership claim is denied", async () => {
    const onActivityChange = vi.fn((active: boolean) => !active);
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

    expect(onActivityChange).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("holds file ownership until the complete import callback settles", async () => {
    let finishImport: (() => void) | undefined;
    const onFileSelect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishImport = resolve;
        }),
    );
    const onActivityChange = vi.fn(() => true);
    render(
      createElement(ConnectorCardWithForm, {
        connector: fileConnector,
        onFileSelect,
        onConnect: vi.fn(),
        onOAuthConnect: vi.fn(),
        onActivityChange,
      }),
    );

    const importPromise = cardState.onFileSelect?.(
      new File(["amount\n10"], "sales.csv"),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(onFileSelect).toHaveBeenCalledOnce();
    expect(onActivityChange.mock.calls).toEqual([[true]]);

    finishImport?.();
    await act(async () => {
      await importPromise;
    });
    expect(onActivityChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does not start a file import when the ownership claim is denied", async () => {
    const onFileSelect = vi.fn().mockResolvedValue(undefined);
    render(
      createElement(ConnectorCardWithForm, {
        connector: fileConnector,
        onFileSelect,
        onConnect: vi.fn(),
        onOAuthConnect: vi.fn(),
        onActivityChange: vi.fn((active: boolean) => !active),
      }),
    );

    await act(async () => {
      await cardState.onFileSelect?.(new File(["amount\n10"], "sales.csv"));
    });

    expect(onFileSelect).not.toHaveBeenCalled();
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
