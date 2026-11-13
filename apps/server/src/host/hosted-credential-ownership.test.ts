import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedCredentialOwnership } from "./hosted-credential-ownership";

afterEach(() => vi.unstubAllGlobals());

it("rejects unsafe configuration before acquiring a token or making a request", () => {
  const getToken = vi.fn(async () => "test-assertion");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const deploymentUrl of [
    "http://backend.example",
    "http://127.0.0.1:3210",
  ]) {
    expect(() =>
      createHostedCredentialOwnership({ deploymentUrl, getToken }),
    ).toThrow();
  }
  expect(getToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the validated HTTPS origin and permits only explicitly opted-in loopback HTTP", async () => {
  const fetch = vi.fn(
    async (_input: Parameters<typeof globalThis.fetch>[0]) =>
      new Response(JSON.stringify({ status: "success", value: null }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const getToken = vi.fn(async () => "test-assertion");
  const options = { deploymentUrl: "https://backend.example/", getToken };
  const secure = createHostedCredentialOwnership(options);
  options.deploymentUrl = "http://untrusted.example";
  await secure.revoke("11111111-1111-4111-8111-111111111111");
  expect(fetch.mock.calls[0]?.[0]).toBe("https://backend.example/api/mutation");
  await createHostedCredentialOwnership({
    deploymentUrl: "http://127.0.0.1:3210",
    getToken,
    allowInsecureLoopbackForTests: true,
  }).revoke("11111111-1111-4111-8111-111111111111");
  expect(fetch.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3210/api/mutation");
  expect(getToken).toHaveBeenCalledTimes(2);
});
