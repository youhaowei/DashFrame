/** Fixed entry point executed only through the native sandbox launcher. */
import { NativeDuckDBEngine } from "./native-engine";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import {
  SANDBOX_MAX_ARROW,
  SANDBOX_MAX_ROWS,
  SANDBOX_PROTOCOL,
  SandboxFrameDecoder,
  decodeParams,
  encodeFrame,
  object,
  tableName,
  type SandboxFrame,
} from "./sandbox-protocol";

const engine = new NativeDuckDBEngine({
  sandboxLimits: {
    memoryBytes: 128 * 1024 * 1024,
    threads: 2,
    maxResultRows: SANDBOX_MAX_ROWS,
  },
});
let busy = false;

function fail(): never {
  // A protocol or transport failure cannot fall through to a live worker.
  process.exit(70);
}

function send(metadata: unknown, payload?: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(encodeFrame(metadata, payload), (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

async function execute(frame: SandboxFrame): Promise<void> {
  const request = object(frame.metadata);
  const id = request.id;
  if (
    request.version !== SANDBOX_PROTOCOL ||
    !Number.isSafeInteger(id) ||
    (id as number) < 1
  )
    fail();
  try {
    let result: Uint8Array | undefined;
    switch (request.operation) {
      case "register":
        if (!frame.payload.length) fail();
        await engine.registerArrowTable(tableName(request.name), frame.payload);
        break;
      case "unregister":
        if (frame.payload.length) fail();
        await engine.unregisterTable(tableName(request.name));
        break;
      case "query":
        if (
          frame.payload.length ||
          typeof request.sql !== "string" ||
          !request.sql.trim()
        )
          fail();
        result = await engine.queryArrow(
          request.sql,
          decodeParams(request.params),
        );
        if (result.byteLength > SANDBOX_MAX_ARROW)
          throw new Error("Result limit");
        break;
      default:
        fail();
    }
    await send({ version: SANDBOX_PROTOCOL, id, status: "ok" }, result);
  } catch {
    // SQL/native messages can contain data, SQL, and paths. Never export them.
    await send({ version: SANDBOX_PROTOCOL, id, status: "error" });
  }
}

process.stdin.on("end", fail);
process.stdin.on("error", fail);
process.stdout.on("error", fail);
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

async function main(): Promise<void> {
  if (
    process.getuid?.() === 0 ||
    Object.keys(process.env).some(
      (key) => !["LANG", "TZ", "HOME"].includes(key),
    )
  )
    fail();
  // Check denials independently of SQL's configuration. The positive read
  // prevents an unusable filesystem/runtime from masquerading as a sandbox.
  readFileSync(__filename);
  try {
    readFileSync("/etc/passwd");
    fail();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EACCES") fail();
  }
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: 9 });
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error("Network available"));
    });
    socket.once("error", (error: NodeJS.ErrnoException) =>
      error.code === "EPERM" ? resolve() : reject(error),
    );
  });
  await engine.initialize();
  // Startup must exercise the actual native query path before reporting ready.
  await engine.queryArrow("SELECT 1 AS ready");
  const decoder = new SandboxFrameDecoder((frame) => {
    if (busy) fail();
    busy = true;
    execute(frame).then(() => {
      busy = false;
    }, fail);
  });
  process.stdin.on("data", (chunk: Buffer) => {
    try {
      decoder.push(chunk);
    } catch {
      fail();
    }
  });
  await send({ version: SANDBOX_PROTOCOL, id: 0, status: "ready" });
}

main().catch(fail);
