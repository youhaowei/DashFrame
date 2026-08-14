import { eslintCompatPlugin } from "@oxlint/plugins";

import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";

const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-reflect-apply": noReflectApplyRule,
    "no-widen-then-assert": noWidenThenAssertRule,
  },
});

export default antiSlopPlugin;
