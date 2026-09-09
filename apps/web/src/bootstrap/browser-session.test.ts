// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { startBrowserSession } from "./browser-session";
import type { BrowserBootstrapView } from "./browser-bootstrap-controller";
import type { BrowserRuntimeConfig } from "./runtime-transport";

const origin = "https://dashframe.test";
const admitted = {
  mode: "hosted",
  status: "admitted",
  subject: "user-a",
  workspaceId: "workspace-a",
  config: { convexUrl: `${origin}/api/convex` },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("rechecks on focus, online and interval without recreating healthy runtime, then stops owned work", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json(admitted));
  vi.stubGlobal("fetch", fetcher);
  const close = vi.fn(async () => {});
  const createRuntime = vi.fn(() => ({ close }));
  const publish = vi.fn();
  const unmount = vi.fn();
  const session = startBrowserSession({
    hostUrl: origin,
    createRuntime,
    publish,
    unmount,
  });
  await vi.waitFor(() => expect(createRuntime).toHaveBeenCalledOnce());
  const views = publish.mock.calls.length;
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(createRuntime).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledTimes(views);
  await session.teardown();
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(close).toHaveBeenCalledOnce();
  expect(unmount).toHaveBeenCalledOnce();
});

describe("runtime access invalidation", () => {
  it.each(["denied", "unavailable"] as const)(
    "closes the runtime after %s notification",
    async (reason) => {
      const fetcher = vi
        .fn()
        .mockImplementationOnce(async () => Response.json(admitted))
        .mockImplementation(async () =>
          Response.json({ mode: "hosted", status: "revoked" }),
        );
      vi.stubGlobal("fetch", fetcher);
      let notify: ((reason: "denied" | "unavailable") => void) | undefined;
      const close = vi.fn(async () => {});
      const views: BrowserBootstrapView<
        BrowserRuntimeConfig,
        { close: typeof close }
      >[] = [];
      const session = startBrowserSession({
        hostUrl: origin,
        createRuntime: (_config, callback) => {
          notify = callback;
          return { close };
        },
        publish: (view) => views.push(view),
        unmount: vi.fn(),
      });
      await vi.waitFor(() => expect(notify).toBeDefined());
      close.mockImplementationOnce(async () => {
        expect(views.at(-1)?.status).toBe("loading");
      });
      notify!(reason);
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(views.at(-1)?.status).toBe(
        reason === "denied" ? "pending-admission" : "unavailable",
      );
      expect(fetcher).toHaveBeenCalledTimes(reason === "denied" ? 2 : 1);
      await session.teardown();
    },
  );
});

it("signs out through the fixed POST action then rechecks, with no redirect fallback", async () => {
  const fetcher = vi
    .fn()
    .mockImplementationOnce(async () =>
      Response.json({ mode: "hosted", status: "pending" }),
    )
    .mockImplementationOnce(async () => new Response(null, { status: 204 }))
    .mockImplementationOnce(async () =>
      Response.json({ mode: "hosted", status: "signed-out" }, { status: 401 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const publish = vi.fn();
  const createRuntime = vi.fn(() => ({ close: async () => {} }));
  const session = startBrowserSession({
    hostUrl: origin,
    createRuntime,
    publish,
    unmount: vi.fn(),
  });
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
  publish.mock.calls.at(-1)![0].onSignOut();
  await vi.waitFor(() =>
    expect(publish.mock.calls.at(-1)![0].status).toBe("signed-out"),
  );
  expect(fetcher.mock.calls[1]).toEqual([
    new URL(`${origin}/auth/logout`),
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      credentials: "same-origin",
    }),
  ]);
  expect(createRuntime).not.toHaveBeenCalled();
  await session.teardown();
});
