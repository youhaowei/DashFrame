import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedMetadata } from "./hosted-convex-metadata";

afterEach(() => vi.unstubAllGlobals());
it("follows the frame list cursor until the backend reports it is done", async () => {
  const cursors: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        path: string;
        args: [{ paginationOpts: { cursor: string | null } }];
      };
      const cursor = body.args[0].paginationOpts.cursor;
      cursors.push(cursor);
      const value =
        cursor === null
          ? { page: [{ id: "frame-1" }], isDone: false, continueCursor: "c1" }
          : { page: [{ id: "frame-2" }], isDone: true, continueCursor: "" };
      return new Response(JSON.stringify({ status: "success", value }), {
        status: 200,
      });
    }),
  );
  const metadata = createHostedMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => "synthetic-host-token",
  });
  expect(
    (await metadata.listDataFramesByInsight("insight")).map((row) => row.id),
  ).toEqual(["frame-1", "frame-2"]);
  expect(cursors).toEqual([null, "c1"]);
});

it("keeps concurrent calls bound to their own token even when token acquisition finishes out of order", async () => {
  let resolveFirst!: (token: string) => void;
  let count = 0;
  const getToken = () =>
    ++count === 1
      ? new Promise<string>((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve("token-b");
  const requests: { id: string; authorization: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { args: [{ id: string }] };
      requests.push({
        id: body.args[0].id,
        authorization: new Headers(init.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ status: "success", value: null }), {
        status: 200,
      });
    }),
  );
  const metadata = createHostedMetadata({
    deploymentUrl: "https://metadata.test",
    getToken,
  });
  const first = metadata.getDataTable("table-a");
  await metadata.getDataTable("table-b");
  resolveFirst("token-a");
  await first;
  expect(requests).toEqual([
    { id: "table-b", authorization: "Bearer token-b" },
    { id: "table-a", authorization: "Bearer token-a" },
  ]);
});

it("does not send an unauthenticated request when the injected signer fails", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => {
      throw new Error("Signer unavailable");
    },
  });
  await expect(metadata.listDataFrames()).rejects.toThrow("Signer unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["http://127.0.0.1:3210", false],
  ["http://127.1:3210", true],
  ["https://user:password@metadata.test", false],
  ["https://meta\ndata.test", false],
  ["not a URL", false],
  ["https://metadata.test/path", false],
])(
  "rejects unsafe deployment %s before requesting a token or accessing the network",
  (deploymentUrl, allowInsecureLoopbackForTests) => {
    const fetch = vi.fn(),
      getToken = vi.fn(async () => "synthetic-host-token");
    vi.stubGlobal("fetch", fetch);
    expect(() =>
      createHostedMetadata({
        deploymentUrl,
        allowInsecureLoopbackForTests,
        getToken,
      }),
    ).toThrow();
    expect(getToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("uses the canonical HTTPS origin for HTTPS://metadata.test:443/", async () => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ status: "success", value: null })),
  );
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedMetadata({
    deploymentUrl: "HTTPS://metadata.test:443/",
    getToken: async () => "synthetic-token",
  });
  await metadata.getDataTable("table");
  expect(fetch.mock.calls[0]?.[0]).toBe("https://metadata.test/api/query");
});
