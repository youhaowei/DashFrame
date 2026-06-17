import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface KeychainOAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Reads the Claude Code OAuth credentials from the macOS keychain.
 * Parses the JSON blob and returns the claudeAiOauth sub-object.
 *
 * Throws with a clear message if the credential is missing or malformed.
 *
 * Uses the async execFile to avoid blocking the event loop — keychain reads
 * are typically fast but can stall on wake-from-sleep or when the keychain
 * is locked; blocking the event loop during those waits is undesirable.
 *
 * Account lookup: Claude Code stores the credential under the signed-in user's
 * account, not under "root". We pass `-a <current-user>` so the lookup matches
 * on any standard macOS installation. `userInfo().username` is the POSIX user
 * running the process — the same account Claude Code uses when writing the item.
 */
export async function readKeychainOAuth(): Promise<KeychainOAuth> {
  let raw: string;
  try {
    // Use the absolute path — avoids PATH-injection risk (sonarjs/no-os-command-from-path).
    // /usr/bin/security is the macOS keychain CLI; this is macOS-only.
    // Interpolate .message only, never the full error object (which can attach
    // stdout/stderr that might contain sensitive output on some error paths).
    const username = userInfo().username;
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-a",
        username,
        "-w",
      ],
      { encoding: "utf-8" },
    );
    raw = stdout.trim();
  } catch (err) {
    throw new Error(
      `Failed to read Claude Code credentials from keychain: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Claude Code keychain entry is not valid JSON — credential may be corrupted",
    );
  }

  const oauth = (parsed as Record<string, unknown>)?.claudeAiOauth as
    | KeychainOAuth
    | undefined;
  if (!oauth) {
    throw new Error(
      "no claudeAiOauth block found in Claude Code keychain entry",
    );
  }

  return oauth;
}
