import sharedConfig from "@dashframe/eslint-config";
import storybook from "eslint-plugin-storybook";

export default [...sharedConfig, ...storybook.configs["flat/recommended"]];
