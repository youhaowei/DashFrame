import sharedConfig from "@dashframe/eslint-config";
import reactHooks from "eslint-plugin-react-hooks";

// The moved app code carries inline `// eslint-disable react-hooks/*` comments
// (the rules came from eslint-config-next in the web app). Register the
// react-hooks plugin here so those directives resolve instead of erroring.
export default [
  ...sharedConfig,
  {
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
];
