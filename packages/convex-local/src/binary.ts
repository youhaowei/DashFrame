import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const BACKEND_VERSION = "precompiled-2026-08-25-7cce8fb";
export const CONVEX_VERSION = "1.37.0";

const RELEASES = {
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    archiveSha256:
      "98831b0f511f6eed70b0b4dfca62015df57877e08017d2b2979b39d62ae7317b",
    binarySha256:
      "3fefa471e11eab56aabf86039ddf825ed1b4dbadadec2df6b88b6ffd9d604400",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    archiveSha256:
      "d142472d996f08907cd9fdf61cc154c36edee3039342f45fdd925cefedabea29",
    binarySha256:
      "19c7c5d32840e506e269b568f6d17a17cec19ac5d8574a713c5ad63bf9b8a997",
  },
  "linux-arm64": {
    triple: "aarch64-unknown-linux-gnu",
    archiveSha256:
      "a0601ec584fe9f514c473af6d57a4c209e4d2d775e4ac1b5d1b90bafd85b7e2f",
    binarySha256:
      "4298f015a44e1f3cf1559fc747fcf0efbde5e1d19228df5be358400f4f054fa1",
  },
  "linux-x64": {
    triple: "x86_64-unknown-linux-gnu",
    archiveSha256:
      "470250263fcf6c71b931219550c3705d9ab03d79c3b1e1e8364465c2b44eff9f",
    binarySha256:
      "97bab85225a860dfd5e9039d9899d76bd419ddc8d863a313f289992b25e82df9",
  },
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    archiveSha256:
      "e20e0bb2db04487706014f3270750db213a8ea0f3e5432e6294f0f8be08a9356",
    binarySha256:
      "b1e2b0920a36aaa43b4daccfdc04368308148485cd5b327a6146b226fae827ae",
  },
} as const;
export function backendTarget(
  platform: string = process.platform,
  arch: string = process.arch,
) {
  const key = `${platform}-${arch}`;
  if (!(key in RELEASES))
    throw new Error(`No pinned Convex backend is available for ${key}.`);
  const release = RELEASES[key as keyof typeof RELEASES];
  return {
    ...release,
    key,
    executable:
      platform === "win32"
        ? "convex-local-backend.exe"
        : "convex-local-backend",
    archive: `convex-local-backend-${release.triple}.zip`,
  };
}
type BackendTarget = ReturnType<typeof backendTarget>;

export function backendExecutableName(): string {
  return backendTarget().executable;
}
export function defaultBinaryPath(target = backendTarget()): string {
  return path.join(
    homedir(),
    ".cache",
    "convex",
    "binaries",
    BACKEND_VERSION,
    ...(target.key === "darwin-arm64" ? [] : [target.key]),
    target.executable,
  );
}

async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Never silently download or upgrade during application startup. */
export async function verifyBackendBinary(
  binaryPath = defaultBinaryPath(),
  target = backendTarget(),
): Promise<string> {
  let digest: string;
  try {
    digest = await fileSha256(binaryPath);
    await access(binaryPath, 1);
  } catch {
    throw new Error(
      "Pinned Convex backend is missing or not executable. Run bun --filter @dashframe/convex-local provision, or install the packaged backend resource.",
    );
  }
  if (digest !== target.binarySha256)
    throw new Error(
      "Convex backend checksum does not match the pinned release; refusing to start.",
    );
  return path.resolve(binaryPath);
}

async function extractBinary(
  archive: string,
  destination: string,
  target: BackendTarget,
): Promise<Buffer> {
  if (process.platform !== "win32") {
    const { stdout } = await promisify(execFile)(
      "/usr/bin/unzip",
      ["-p", archive, target.executable],
      { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
    );
    return stdout;
  }
  const folder = `${destination}.extract`;
  await mkdir(folder, { mode: 0o700 });
  try {
    // EncodedCommand carries a quoted literal path, never a caller-supplied program.
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const command = `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(folder)}`;
    await promisify(execFile)(
      path.win32.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      { timeout: 60_000, windowsHide: true },
    );
    return await readFile(path.join(folder, target.executable));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Explicit development/build provisioning, separate from the offline runtime. */
export async function provisionBackendBinary(
  outputPath?: string,
  target = backendTarget(),
): Promise<string> {
  const destination = outputPath ?? defaultBinaryPath(target);
  const response = await fetch(
    `https://github.com/get-convex/convex-backend/releases/download/${BACKEND_VERSION}/${target.archive}`,
    {
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not download pinned Convex backend (${response.status}).`,
    );
  const archive = new Uint8Array(await response.arrayBuffer());
  if (sha256(archive) !== target.archiveSha256)
    throw new Error("Convex release archive checksum mismatch.");
  const licenseResponse = await fetch(
    `https://github.com/get-convex/convex-backend/releases/download/${BACKEND_VERSION}/LICENSE.md`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!licenseResponse.ok)
    throw new Error("Could not download the Convex backend license.");
  const license = new Uint8Array(await licenseResponse.arrayBuffer());
  if (
    sha256(license) !==
    "cee614f23a461cb4aba2910e7127ae0969bcf42a0a91a38d3e3449d843383086"
  )
    throw new Error("Convex license checksum mismatch.");
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}`;
  try {
    await writeFile(`${temporary}.zip`, archive, { mode: 0o600, flag: "wx" });
    const stdout = await extractBinary(`${temporary}.zip`, temporary, target);
    if (sha256(stdout) !== target.binarySha256)
      throw new Error("Convex executable checksum mismatch.");
    await writeFile(temporary, stdout, { mode: 0o700, flag: "wx" });
    await chmod(temporary, 0o700);
    await writeFile(
      path.join(path.dirname(destination), "LICENSE.md"),
      license,
      { mode: 0o600 },
    );
    await rename(temporary, destination);
    return destination;
  } finally {
    await rm(`${temporary}.zip`, { force: true });
    await rm(temporary, { force: true });
  }
}
