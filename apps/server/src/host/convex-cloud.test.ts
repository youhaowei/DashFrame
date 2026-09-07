import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { describe, expect, it } from "vite-plus/test";

import { assertConvexCloudUrl, connectConvexCloud } from "./convex-cloud";

const DEPLOY_KEY = "prod:tidy-otter-123|super-secret-deploy-key";

type Ping = FunctionReference<
  "query",
  "internal",
  Record<string, never>,
  { ok: boolean }
>;
const ping = makeFunctionReference<
  "query",
  Record<string, never>,
  { ok: boolean }
>("host:ping") as unknown as Ping;

describe("accepting a Convex deployment URL", () => {
  it("accepts an https deployment origin", () => {
    expect(
      assertConvexCloudUrl("https://tidy-otter-123.convex.cloud").protocol,
    ).toBe("https:");
  });

  // The deploy key is bearer-equivalent admin authority over the deployment, so
  // the only cleartext target permitted is one that cannot leave the machine.
  it("accepts http only on loopback, for tests", () => {
    expect(assertConvexCloudUrl("http://127.0.0.1:3210").protocol).toBe(
      "http:",
    );
    expect(() => assertConvexCloudUrl("http://convex.example.com")).toThrow(
      /must be https/,
    );
    expect(() => assertConvexCloudUrl("http://127.evil.example")).toThrow(
      /must be https/,
    );
  });

  it("rejects a non-URL and a non-http scheme", () => {
    expect(() => assertConvexCloudUrl("tidy-otter-123")).toThrow(/not a URL/);
    expect(() => assertConvexCloudUrl("file:///etc/passwd")).toThrow(
      /must be https/,
    );
  });
});

describe("attaching to a Convex Cloud deployment", () => {
  function stubFetch(handler: (url: string, init: RequestInit) => Response): {
    calls: Array<{ url: string; init: RequestInit }>;
    fetch: typeof fetch;
  } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      return Promise.resolve(handler(url, init));
    }) as unknown as typeof fetch;
    return { calls, fetch: impl };
  }

  const success = () =>
    new Response(JSON.stringify({ status: "success", value: { ok: true } }), {
      headers: { "content-type": "application/json" },
    });

  it("writes nothing to the deployment when attaching", async () => {
    const stub = stubFetch(success);
    await connectConvexCloud({
      url: "https://tidy-otter-123.convex.cloud",
      adminKey: DEPLOY_KEY,
      fetchImpl: stub.fetch,
    });
    // The trust anchor is published by the release pipeline. A server that
    // configured the deployment on boot would make "who does the backend trust"
    // depend on which container started last.
    expect(stub.calls).toEqual([]);
  });

  it("calls internal functions with the admin scheme", async () => {
    const stub = stubFetch(success);
    const backend = await connectConvexCloud({
      url: "https://tidy-otter-123.convex.cloud",
      adminKey: DEPLOY_KEY,
      fetchImpl: stub.fetch,
    });
    await expect(backend.internalClient.query(ping, {})).resolves.toEqual({
      ok: true,
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.url).toBe(
      "https://tidy-otter-123.convex.cloud/api/query",
    );
    expect(
      (stub.calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBe(`Convex ${DEPLOY_KEY}`);
  });

  it("normalizes a trailing slash rather than producing a doubled path", async () => {
    const stub = stubFetch(success);
    const backend = await connectConvexCloud({
      url: "https://tidy-otter-123.convex.cloud/",
      adminKey: DEPLOY_KEY,
      fetchImpl: stub.fetch,
    });
    expect(backend.url).toBe("https://tidy-otter-123.convex.cloud");
    await backend.internalClient.query(ping, {});
    expect(stub.calls[0]!.url).toBe(
      "https://tidy-otter-123.convex.cloud/api/query",
    );
  });

  it("never puts the deploy key in a failure message", async () => {
    const stub = stubFetch(
      () => new Response("nope", { status: 500, statusText: "boom" }),
    );
    const backend = await connectConvexCloud({
      url: "https://tidy-otter-123.convex.cloud",
      adminKey: DEPLOY_KEY,
      fetchImpl: stub.fetch,
    });
    // Deployment diagnostics get logged routinely; a leaked deploy key is full
    // control of the deployment.
    await expect(backend.internalClient.query(ping, {})).rejects.toThrow(
      /Convex Cloud internal query failed/,
    );
    await expect(backend.internalClient.query(ping, {})).rejects.not.toThrow(
      new RegExp(DEPLOY_KEY),
    );
  });

  it("settles `closed` on stop so a shutdown cannot hang on it", async () => {
    const backend = await connectConvexCloud({
      url: "https://tidy-otter-123.convex.cloud",
      adminKey: DEPLOY_KEY,
      fetchImpl: stubFetch(success).fetch,
    });
    let settled = false;
    void backend.closed.then(() => {
      settled = true;
    });
    await backend.stop();
    await backend.closed;
    expect(settled).toBe(true);
  });
});
