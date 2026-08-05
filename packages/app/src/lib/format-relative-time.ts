/** Format `timestamp` (epoch ms) relative to `now` (epoch ms) as a short "Nd/h/m ago" string. */
export function formatRelativeTime(now: number, timestamp: number): string {
  const diff = now - timestamp;
  // `now` is 0 on the server snapshot (useSyncExternalStore's SSR fallback,
  // before the client clock hydrates) — every timestamp then reads as
  // "in the future", which would otherwise fall through every branch below
  // to "just now" and produce a hydration mismatch once the client clock
  // ticks in. Render a neutral placeholder instead until `now` is real.
  if (diff < 0) return "—";
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
