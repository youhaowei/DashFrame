# @dashframe/assistant

Agentic report harness substrate: OAuth credential lifecycle (Claude Code
keychain token), the typed tool-layer helper, the privacy-aware READ layer,
the `applyCommand` mutation tool, and the provider measurement harness
documented below.

## Provider measurement CLI

`src/provider-measurement.cli.ts` runs a one-shot streaming measurement
against each configured provider (latency, time-to-first-token, stop reason,
usage) and prints the results as JSON. Run it from `packages/assistant`:

```bash
bun run measure:providers
```

It exits non-zero if any provider run did not complete successfully
(`result.ok === false`), so it's safe to use as a smoke check.

### Anthropic credential resolution

Before measuring, the CLI calls `ensureAnthropicCredential()`
(`src/provider-credential.ts`), which resolves a credential in this order:

1. If `ANTHROPIC_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` is already set in the
   environment, it's used as-is — explicit config always wins.
2. Otherwise, it reads a live OAuth token from the macOS keychain (the same
   token Claude Code uses) and sets it as `ANTHROPIC_OAUTH_TOKEN` for the
   run.
3. If neither is available (no env var, no keychain entry, non-macOS host,
   expired token with a dead refresh), it prints a fixed hint to stderr and
   leaves the environment untouched — the run then fails downstream with a
   "no credentials" style error from pi-ai.

### Bedrock preconditions (not live-validated)

The `amazon-bedrock` leg reads `AWS_REGION` / `AWS_PROFILE` directly from
`process.env` (see `measureProviderRuns` in `src/provider-measurement.ts`) and
passes them through to the provider run. Unlike the Anthropic leg, there is
**no resolver or keychain fallback** — you must have AWS credentials already
configured before running the CLI, e.g.:

- `AWS_PROFILE` pointing at a profile in `~/.aws/config` /
  `~/.aws/credentials` (including one backed by AWS SSO), and
- `AWS_REGION` set to a region where the target Bedrock model is available.

This leg has not yet been exercised successfully in CI or locally — every
attempt so far has failed with "Could not load credentials from any
providers." Credential-resolution parity with the Anthropic leg (keychain or
another non-env fallback) is future scope, not implemented today.

### Prompt override

Set `DASHFRAME_PROVIDER_MEASUREMENT_PROMPT` to replace the default
measurement prompt sent to every provider in the run:

```bash
DASHFRAME_PROVIDER_MEASUREMENT_PROMPT="Say hello in one word." bun run measure:providers
```

When unset, `measureProviderRuns` falls back to a built-in default prompt
that asks for a single concise JSON object.

### Model overrides

`DASHFRAME_ANTHROPIC_MODEL` and `DASHFRAME_BEDROCK_MODEL` override the model
ID used for each provider's run (see `measureProviderRuns`). When unset, the
CLI picks the first model from a built-in default list that's registered in
pi-ai for that provider.
