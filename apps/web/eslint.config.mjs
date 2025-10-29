import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import sharedConfig from "@dash-frame/eslint-config";

export default defineConfig([
    ...sharedConfig,
    ...nextCoreWebVitals,
    ...nextTypescript,
]);
