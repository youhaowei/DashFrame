import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedTokenIssuer } from "./hosted-token-issuer";
import { createHostedAdmissionService } from "./hosted-admission-service";

afterEach(() => vi.unstubAllGlobals());

it("resolves concurrent verified users through distinct signed assertions without body scope", async () => {
  const tokens = createHostedTokenIssuer({
    issuer: "https://runtime.invalid",
    privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
  });
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const token = new Headers(init?.headers).get("authorization")!.slice(7);
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1]!, "base64url").toString(),
      ) as { userId: string; authority: string; workspaceId?: string };
      expect(claims.authority).toBe("host");
      expect(claims.workspaceId).toBeUndefined();
      expect(JSON.parse(String(init?.body))).toMatchObject({
        path: "admission:resolve",
        args: [{}],
      });
      seen.push(claims.userId);
      return new Response(
        JSON.stringify({
          status: "success",
          value:
            claims.userId === "a"
              ? { status: "admitted", workspaceId: "workspace-a" }
              : { status: "pending", workspaceId: null },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  const service = createHostedAdmissionService({
    deploymentUrl: "https://deployment.invalid",
    tokens,
  });
  expect(
    await Promise.all(
      ["a", "b"].map((userId) =>
        service.resolve({ userId, expiresAt: Date.now() + 120_000 }),
      ),
    ),
  ).toEqual([
    { status: "admitted", workspaceId: "workspace-a" },
    { status: "pending", workspaceId: null },
  ]);
  expect(seen.sort()).toEqual(["a", "b"]);
});

it("rejects invalid configuration before signing and never treats an outage as admission", async () => {
  const admission = vi.fn(() => ({
    token: "synthetic",
    expiresAt: Date.now() + 60_000,
  }));
  expect(() =>
    createHostedAdmissionService({
      // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- asserts rejection before any network request
      deploymentUrl: "http://untrusted.invalid",
      tokens: { admission },
    }),
  ).toThrow();
  expect(admission).not.toHaveBeenCalled();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("unavailable", { status: 503 })),
  );
  const service = createHostedAdmissionService({
    deploymentUrl: "https://deployment.invalid",
    tokens: { admission },
  });
  await expect(
    service.resolve({ userId: "a", expiresAt: Date.now() + 120_000 }),
  ).rejects.toThrow();
});
