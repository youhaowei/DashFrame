import { expect, expectTypeOf, it } from "vite-plus/test";
import { api } from "@dashframe/convex-backend/api";
import * as app from "@dashframe/convex-backend/app";
import { CONVEX_QUERY_NAMES, CONVEX_MUTATION_NAMES } from "./dispatch";

// api.app is a lazy proxy: any property looks valid at runtime. Check its
// generated type and the actual registered exports, not proxy membership.
it.each([
  ...CONVEX_QUERY_NAMES.map((name) => ({ name, flag: "isQuery" })),
  ...CONVEX_MUTATION_NAMES.map((name) => ({ name, flag: "isMutation" })),
])(
  "dispatches $name to an existing Convex $flag function",
  ({ name, flag }) => {
    expectTypeOf<typeof name>().toExtend<keyof typeof api.app>();
    expect(app).toHaveProperty(name);
    expect(app[name]).toHaveProperty(flag, true);
  },
);
