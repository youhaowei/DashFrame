import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import sharedConfig, { sharedRules } from "@dashframe/eslint-config";

const stripDuplicateTypescriptPlugin = (config) => {
  if (
    !config ||
    typeof config !== "object" ||
    !config.plugins ||
    !config.plugins["@typescript-eslint"]
  ) {
    return config;
  }

  const otherPlugins = { ...config.plugins };
  delete otherPlugins["@typescript-eslint"];

  if (Object.keys(otherPlugins).length === 0) {
    const configWithoutPlugins = { ...config };
    delete configWithoutPlugins.plugins;
    return configWithoutPlugins;
  }

  return {
    ...config,
    plugins: otherPlugins,
  };
};

const nextTypescriptWithoutDuplicatePlugin = nextTypescript.map(
  stripDuplicateTypescriptPlugin,
);

export default defineConfig([
  ...sharedConfig,
  ...nextCoreWebVitals,
  ...nextTypescriptWithoutDuplicatePlugin,
  {
    rules: sharedRules,
  },
]);
