/**
 * `loose` — bridge one WyStack type quirk at the mutation boundary.
 *
 * WyStack's `InferArg<C> = C extends ColumnDef<infer T, any> ? T : never`
 * discards the column's optional flag (the second type param is `any`). So a
 * handler arg declared `description: text.optional()` is validated as optional
 * at runtime but *typed* as a required `string` in the generated `mutateAsync`
 * signature. Passing the genuinely-optional domain value (`string | undefined`)
 * then fails typecheck even though the server accepts it.
 *
 * `loose` is a typed identity at runtime that erases the arg's compile-time
 * type to `never`, so it satisfies any `mutateAsync` parameter. It's the one
 * sanctioned escape hatch for this specific upstream gap — not a license to
 * pass wrong shapes; the object literal above each call still documents the
 * real shape. When WyStack fixes `InferArg` to honor optionality, delete this
 * and unwrap the calls.
 */
export function loose<T extends object>(args: T): never {
  return args as never;
}
