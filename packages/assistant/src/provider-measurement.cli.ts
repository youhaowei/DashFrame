import { measureProviderRuns } from "./provider-measurement.js";

const prompt = process.env.DASHFRAME_PROVIDER_MEASUREMENT_PROMPT;

const results = await measureProviderRuns({ prompt });
console.log(JSON.stringify({ results }, null, 2));

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
