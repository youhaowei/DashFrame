/** Format `timestamp` (epoch ms) relative to `now` (epoch ms) as a short "Nd/h/m ago" string. */
export function formatRelativeTime(now: number, timestamp: number): string {
  // `now` is 0 on the server snapshot (useSyncExternalStore's SSR fallback,
  // before the client clock hydrates). Render a neutral placeholder until
  // `now` is real, so the first client render matches.
  if (now <= 0) return "—";
  // useNow ticks once a minute, so a write from the last minute can carry a
  // timestamp ahead of it. That is fresh, not unknown.
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
