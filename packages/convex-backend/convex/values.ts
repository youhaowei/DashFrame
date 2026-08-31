import { v, type Validator } from "convex/values";
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
// Metadata is JSON, bounded to protect both the isolate and Convex's document depth limit.
function jsonAtDepth(depth: number): Validator<Json, "required", string> {
  const scalar = v.union(v.null(), v.boolean(), v.number(), v.string());
  if (depth === 0) return scalar;
  const child = jsonAtDepth(depth - 1);
  return v.union(scalar, v.array(child), v.record(v.string(), child));
}
export const json = jsonAtDepth(8);
export const object = v.record(v.string(), json);
export const command = v.object({
  id: v.optional(v.string()),
  path: v.string(),
  args: object,
});
export const publicCommand = command as unknown as Validator<Command>;
export type Command = { id?: string; path: string; args: unknown };
export function typed<T>(
  validator: Validator<unknown, "required", string>,
): Validator<T> {
  return validator as unknown as Validator<T>;
}
export function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function record(value: unknown): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected object");
  return value as ObjectValue;
}
