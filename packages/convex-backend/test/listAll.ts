import type { TestConvexForDataModel } from "convex-test";
import type {
  DataModelFromSchemaDefinition,
  FunctionReference,
  OptionalRestArgs,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import { followPages, PAGE_LIMIT } from "../convex/pages";
import type schema from "../convex/schema";

type Caller = Pick<
  TestConvexForDataModel<DataModelFromSchemaDefinition<typeof schema>>,
  "query"
>;
type ListRef = FunctionReference<
  "query",
  "public",
  { paginationOpts: PaginationOptions },
  PaginationResult<unknown>
>;

/**
 * Every row of a paginated list, read the way the app's readers do. `numItems`
 * sets the page size so a test can cross a page boundary without seeding
 * hundreds of rows.
 */
export function listAll<Q extends ListRef>(
  caller: Caller,
  ref: Q,
  args: Omit<Q["_args"], "paginationOpts">,
  numItems = PAGE_LIMIT,
): Promise<Q["_returnType"]["page"]> {
  return followPages<Q["_returnType"]["page"][number]>(
    (paginationOpts) =>
      caller.query(
        ref,
        ...([{ ...args, paginationOpts }] as unknown as OptionalRestArgs<Q>),
      ),
    numItems,
  );
}
