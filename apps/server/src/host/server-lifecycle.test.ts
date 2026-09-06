import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { exerciseHostShutdown } from "./server-lifecycle.fixture";

it("closes live HTTP and proxied WebSocket transports under Node", async () => {
  await exerciseHostShutdown();
});

it("closes live proxied WebSockets under Bun and exits without forced termination", async () => {
  const result = await new Promise<{ stdout: string }>((resolve, reject) => {
    const child = execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- The repo requires Bun on PATH; this test exercises that runtime.
      "bun",
      [
        fileURLToPath(
          new URL("./server-lifecycle.fixture.ts", import.meta.url),
        ),
        "--signal",
      ],
      { timeout: 8000, killSignal: "SIGKILL" },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      },
    );
    let output = "";
    let signalled = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (!signalled && output.includes("Ready for SIGTERM")) {
        signalled = true;
        child.kill("SIGTERM");
      }
    });
  });
  expect(result.stdout).toContain(
    "Host and upstream closed; listener port reusable",
  );
}, 10_000);
