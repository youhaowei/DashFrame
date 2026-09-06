import type { z } from "zod";
import { requireUser, type HostContext } from "./context";

/** Validate an HTTP body before invoking a native host capability. */
export function hostOperation<S extends z.ZodType, Result>(options: {
  input: S;
  userOnly?: boolean;
  run: (ctx: HostContext, input: z.output<S>) => Promise<Result>;
}) {
  return async (ctx: HostContext, input: z.input<S>): Promise<Result> => {
    if (options.userOnly) requireUser(ctx);
    return options.run(ctx, options.input.parse(input));
  };
}
