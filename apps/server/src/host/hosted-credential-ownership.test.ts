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
    "http://localhost:3210",
    "https://user:password@backend.example",
    "https://user@backend.example",
    "ftp://backend.example",
    "file:///tmp/backend",
    "not a URL",
    "https:backend.example",
    "//backend.example",
    "https://",
    " https://backend.example",
    "https://backend.example\n",
    "https://backend.example/path",
    "https://backend.example?target=other",
    "https://backend.example#fragment",
    "https://backend.example\\@other.example",
  ]) {
    expect(() =>
      createHostedCredentialOwnership({ deploymentUrl, getToken }),
    ).toThrow();
  }
  for (const deploymentUrl of [
    "http://backend.example",
    "http://localhost:3210",
    "http://127.0.0.2:3210",
    "http://127.1:3210",
    "http://2130706433:3210",
    // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- rejected transport fixture
    "http://[::1]:3210",
    "http://127.0.0.1.example:3210",
    "http://user@127.0.0.1:3210",
    "http://127.0.0.1:3210/path",
  ]) {
    expect(() =>
      createHostedCredentialOwnership({
        deploymentUrl,
        getToken,
        allowInsecureLoopbackForTests: true,
      }),
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
