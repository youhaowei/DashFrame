import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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

// This initial desktop distribution is deliberately macOS/Apple Silicon only.
// Add another platform only with a verified archive AND extracted binary digest.
const RELEASE = {
  archive: "convex-local-backend-aarch64-apple-darwin.zip",
  archiveSha256:
    "98831b0f511f6eed70b0b4dfca62015df57877e08017d2b2979b39d62ae7317b",
  binarySha256:
    "3fefa471e11eab56aabf86039ddf825ed1b4dbadadec2df6b88b6ffd9d604400",
};

function assertPlatform() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      "Local Convex is currently packaged for macOS Apple Silicon only.",
    );
  }
}

export function defaultBinaryPath(): string {
  return path.join(
    homedir(),
    ".cache",
    "convex",
    "binaries",
    BACKEND_VERSION,
    "convex-local-backend",
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Never silently download or upgrade during application startup. */
export async function verifyBackendBinary(
  binaryPath = defaultBinaryPath(),
): Promise<string> {
  assertPlatform();
  let bytes: Buffer;
  try {
    bytes = await readFile(binaryPath);
    await access(binaryPath, 1);
  } catch {
    throw new Error(
      "Pinned Convex backend is missing or not executable. Run bun --filter @dashframe/convex-local provision, or install the packaged backend resource.",
    );
  }
  if (sha256(bytes) !== RELEASE.binarySha256) {
    throw new Error(
      "Convex backend checksum does not match the pinned release; refusing to start.",
    );
  }
  return path.resolve(binaryPath);
}

/** Explicit development/build provisioning, separate from the offline runtime. */
export async function provisionBackendBinary(
  destination = defaultBinaryPath(),
): Promise<string> {
  assertPlatform();
  const response = await fetch(
    `https://github.com/get-convex/convex-backend/releases/download/${BACKEND_VERSION}/${RELEASE.archive}`,
    {
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not download pinned Convex backend (${response.status}).`,
    );
  const archive = new Uint8Array(await response.arrayBuffer());
  if (sha256(archive) !== RELEASE.archiveSha256)
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
    const { stdout } = await promisify(execFile)(
      "/usr/bin/unzip",
      ["-p", `${temporary}.zip`, "convex-local-backend"],
      {
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    if (sha256(stdout) !== RELEASE.binarySha256)
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
