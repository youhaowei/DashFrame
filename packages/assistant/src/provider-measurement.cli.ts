import { ensureAnthropicCredential } from "./provider-credential.js";
import { measureProviderRuns } from "./provider-measurement.js";

/**
 * Optional override for the measurement prompt sent to every provider run.
 * Falls back to `measureProviderRuns`'s built-in default prompt when unset.
 * See packages/assistant/README.md for usage.
 */
const prompt = process.env.DASHFRAME_PROVIDER_MEASUREMENT_PROMPT;

await ensureAnthropicCredential();

const results = await measureProviderRuns({ prompt });
console.log(JSON.stringify({ results }, null, 2));

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
