import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/wystack/client", () => ({
  getWyStackClient: () => ({ mutate }),
}));

import { rejectOAuthSetupWithoutAuthorizationUrl } from "./ConnectorCardWithForm";

describe("rejectOAuthSetupWithoutAuthorizationUrl", () => {
  beforeEach(() => {
    mutate.mockReset();
    mutate.mockResolvedValue(undefined);
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
