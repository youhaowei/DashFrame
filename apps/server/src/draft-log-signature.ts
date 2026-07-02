/**
 * Content signature of a draft's command log — the review-drift guard's
 * second, stronger check (alongside `expectedCommandCount`).
 *
 * WHY a count alone is not enough: `compactLog` (see `@wystack/server`) can
 * DROP earlier log positions — a create cancelled by a later delete collapses
 * to nothing, so the surviving list can shrink while a DIFFERENT command that
 * landed after the reviewer's read fills the gap. A concurrent append that
 * triggers this kind of compaction can leave `log.length` unchanged from what
 * the reviewer saw while the actual content differs. Same-count content drift
 * slips a count-only guard. A content signature closes that gap: it is
 * sensitive to which commands survived, not just how many.
 *
 * DETERMINISM is the whole point of this file. The signature must be
 * byte-for-byte identical for an unchanged log whether it is computed at
 * review time (`draftPublishReview`) or recomputed inside the publish
 * transaction (`DraftController.publishDraft`) — both call sites import THIS
 * function, so there is exactly one serializer to keep in sync, never two.
 * `draft_command_log.args` is stored as `jsonb`, which does not preserve
 * object key insertion order across a write/read round trip, so `args` is
 * serialized with keys sorted (recursively, arrays keep their order) rather
 * than relying on JSON.stringify's insertion-order behavior.
 */
import type { Command } from "@wystack/server";
import { createHash } from "node:crypto";

/**
 * Recursively sort object keys so structurally-equal values serialize
 * identically regardless of key insertion order (which `jsonb` does not
 * preserve). Arrays keep their order — position is semantic there, unlike
 * object keys.
 *
 * Built via `Object.fromEntries`, NOT `out[key] = ...` assignment: command
 * args are attacker-influenced JSON, and a key literally named `__proto__`
 * assigned with bracket notation invokes the legacy prototype SETTER instead
 * of creating an enumerable own property — the field would silently vanish
 * from `JSON.stringify`, making a log that differs only in a `__proto__`
 * argument value hash identically to one that doesn't (the signature's whole
 * job is to catch content differences). `Object.fromEntries` defines each
 * entry as a genuine own property, so `__proto__` round-trips like any other
 * key.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

/**
 * Compute a deterministic content signature over a command log in replay
 * order. Only `path` and `args` participate — the fields that determine what
 * publish actually DOES. `id`/`compactionKey`/`kind` are replay bookkeeping,
 * not content the reviewer evaluated, and including them would make the
 * signature sensitive to compaction-internal metadata rather than to the
 * commands' user-visible effect.
 *
 * Returns a SHA-256 hex digest — an opaque string the client ferries back
 * verbatim (RPC args are text; hex round-trips without escaping concerns).
 */
export function computeLogSignature(log: Command[]): string {
  const canonical = log.map((command) => ({
    path: command.path,
    args: canonicalize(command.args ?? null),
  }));
  const serialized = JSON.stringify(canonical);
  return createHash("sha256").update(serialized).digest("hex");
}
