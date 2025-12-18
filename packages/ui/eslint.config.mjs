import storybook from "eslint-plugin-storybook";
import sharedConfig from "@dashframe/eslint-config";

export default [...sharedConfig, ...storybook.configs["flat/recommended"]];
