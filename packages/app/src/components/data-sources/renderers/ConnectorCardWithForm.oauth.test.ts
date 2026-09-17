import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import type {
  FileSourceConnector,
  RemoteApiConnector,
} from "@dashframe/engine";

const { cardState, execute, mutate, openUrl } = vi.hoisted(() => ({
  cardState: {
    onConnect: undefined as (() => Promise<void>) | undefined,
    onFileSelect: undefined as ((file: File) => Promise<void>) | undefined,
    signInUrl: undefined as string | undefined,
  },
  execute: vi.fn(),
  mutate: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@/data/host", async (importOriginal) => ({
  HostOperationError: (await importOriginal<typeof import("@/data/host")>())
    .HostOperationError,
  requestHost: mutate,
}));
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
  openOAuthAuthorizationUrl: openUrl,
}));
vi.mock("./ConnectorCard", () => ({
  ConnectorCard: ({
    onConnect,
    onFileSelect,
    signInUrl,
  }: {
    onConnect: () => Promise<void>;
    onFileSelect: (file: File) => Promise<void>;
    signInUrl?: string;
  }) => {
    cardState.signInUrl = signInUrl;
    cardState.onConnect = onConnect;
    cardState.onFileSelect = onFileSelect;
    return null;
  },
}));

import { ConnectorCardWithForm } from "./ConnectorCardWithForm";

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

describe("ConnectorCardWithForm OAuth setup", () => {
  beforeEach(() => {
    cardState.onConnect = undefined;
    cardState.onFileSelect = undefined;
    cardState.signInUrl = undefined;
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
    openUrl.mockReset();
    openUrl.mockResolvedValue(true);
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

  function renderOAuthCard(unavailableReason?: string) {
    const onActivityChange = vi.fn(() => true);
    render(
      createElement(ConnectorCardWithForm, {
        connector: oauthConnector,
        onFileSelect: vi.fn(),
        onConnect: vi.fn(),
        onOAuthConnect: vi.fn(),
        onActivityChange,
        unavailableReason,
      }),
    );
    return { onActivityChange };
  }

  it("does not start setup or open anything when the server cannot start OAuth", async () => {
    const { onActivityChange } = renderOAuthCard(
      "Google sign-in isn't set up on this server.",
    );

    await act(async () => {
      await cardState.onConnect?.();
    });

    expect(onActivityChange).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  async function setupErrorMessage(cause: unknown) {
    mutate.mockRejectedValue(cause);
    let shown: string | undefined;
    execute.mockImplementation(
      async (
        action: () => Promise<unknown>,
        options?: { errorMessage?: (error: unknown) => string | undefined },
      ) => {
        try {
          return await action();
        } catch (error) {
          shown = options?.errorMessage?.(error);
          return null;
        }
      },
    );
    renderOAuthCard();
    await act(async () => {
      await cardState.onConnect?.();
    });
    return shown;
  }

  it("shows the server's reason when it rejects setup", async () => {
    const { HostOperationError } = await import("@/data/host");
    expect(
      await setupErrorMessage(
        new HostOperationError(
          "Google Analytics OAuth is not configured",
          undefined,
          undefined,
          true,
        ),
      ),
    ).toBe("Google Analytics OAuth is not configured");
  });

  it("keeps generic copy for network failures", async () => {
    expect(
      await setupErrorMessage(new TypeError("Failed to fetch")),
    ).toBeUndefined();
  });

  it("opens nothing when setup fails to start", async () => {
    mutate.mockRejectedValue(
      new Error("Google Analytics OAuth is not configured"),
    );
    renderOAuthCard();

    await act(async () => {
      await cardState.onConnect?.();
    });

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens the authorization URL only after the server issues it", async () => {
    const order: string[] = [];
    mutate.mockImplementation(async (operation: string) => {
      order.push(operation);
      if (operation === "startConnectorSetup") {
        return {
          sessionId: "session-1",
          authorizeUrl: "https://accounts.google.com/auth",
        };
      }
      return { state: "awaiting-user-auth" };
    });
    openUrl.mockImplementation(async (url: string) => {
      order.push(`open:${url}`);
      return true;
    });
    renderOAuthCard();

    const connecting = cardState.onConnect?.();
    await act(async () => {
      await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());
    });

    expect(order.slice(0, 2)).toEqual([
      "startConnectorSetup",
      "open:https://accounts.google.com/auth",
    ]);
    expect(connecting).toBeInstanceOf(Promise);
  });

  it("cancels the issued session when no authorization URL comes back", async () => {
    mutate.mockImplementation(async (operation: string) =>
      operation === "startConnectorSetup"
        ? { sessionId: "session-1" }
        : undefined,
    );
    renderOAuthCard();

    await act(async () => {
      await cardState.onConnect?.();
    });

    expect(openUrl).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenLastCalledWith("cancelConnectorSetup", {
      sessionId: "session-1",
    });
  });

  it("keeps the session and offers the sign-in link when no window opens", async () => {
    mutate.mockImplementation(async (operation: string) =>
      operation === "startConnectorSetup"
        ? {
            sessionId: "session-3",
            authorizeUrl: "https://accounts.google.com/auth",
          }
        : { state: "awaiting-user-auth" },
    );
    openUrl.mockResolvedValue(false);
    renderOAuthCard();

    // act flushes the card's re-render only once its callback returns.
    await act(async () => {
      void cardState.onConnect?.();
      await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());
    });

    expect(cardState.signInUrl).toBe("https://accounts.google.com/auth");
    expect(mutate).not.toHaveBeenCalledWith(
      "cancelConnectorSetup",
      expect.anything(),
    );
  });

  it("cancels the issued session when the sign-in page cannot be opened", async () => {
    mutate.mockImplementation(async (operation: string) =>
      operation === "startConnectorSetup"
        ? {
            sessionId: "session-2",
            authorizeUrl: "https://accounts.google.com/auth",
          }
        : undefined,
    );
    openUrl.mockRejectedValue(new Error("blocked"));
    renderOAuthCard();

    await act(async () => {
      await cardState.onConnect?.();
    });

    expect(mutate).toHaveBeenLastCalledWith("cancelConnectorSetup", {
      sessionId: "session-2",
    });
  });
});
