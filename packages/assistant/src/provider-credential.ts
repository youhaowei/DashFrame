import { getOAuthToken } from "./oauth/index.js";

/**
 * User-facing hint printed when no Anthropic credential is available from
 * either the environment or the keychain. Fixed copy — never interpolates
 * the underlying error, which may otherwise echo credential-adjacent detail.
 */
const NO_CREDENTIAL_HINT =
  "[assistant] no Anthropic credential: set ANTHROPIC_API_KEY or log in to Claude Code";

export interface EnsureAnthropicCredentialOptions {
  /** Defaults to `process.env`. Mutated in place when the keychain fallback fires. */
  env?: Record<string, string | undefined>;
  /** Defaults to the real `getOAuthToken` (macOS keychain read + refresh). */
  getToken?: () => Promise<string>;
  /** Defaults to a stderr writer. Receives only the fixed hint string, never secret material. */
  log?: (message: string) => void;
}

/**
 * Ensures `env.ANTHROPIC_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) is set before
 * a provider-measurement run so pi-ai's `streamSimple` can resolve an
 * Anthropic credential.
 *
 * Resolution order:
 * 1. If `ANTHROPIC_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` is already set
 *    (non-empty) in `env` → do nothing. Explicit config always wins over the
 *    implicit keychain fallback.
 * 2. Otherwise, resolve a live token via `getToken()` (the package's own
 *    macOS-keychain-backed OAuth provider) and set it as
 *    `env.ANTHROPIC_OAUTH_TOKEN`.
 * 3. If the keychain resolution fails (no entry, expired + dead refresh,
 *    non-macOS host, etc.), print a fixed user-facing hint — never the
 *    underlying error — and leave `env` untouched so the caller's downstream
 *    "No API key for provider" failure surfaces normally.
 *
 * Security invariant: the resolved token is only ever assigned into `env`,
 * never logged, printed, or returned to the caller.
 */
export async function ensureAnthropicCredential(
  options: EnsureAnthropicCredentialOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const getToken = options.getToken ?? getOAuthToken;
  const log =
    options.log ?? ((message: string) => process.stderr.write(`${message}\n`));

  if (env.ANTHROPIC_OAUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim()) {
    return;
  }

  try {
    const token = await getToken();
    env.ANTHROPIC_OAUTH_TOKEN = token;
  } catch {
    log(NO_CREDENTIAL_HINT);
  }
}
