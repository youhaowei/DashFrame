const MAX_CLOCK_LEAD_MS = 60_000;

/** Format `timestamp` (epoch ms) relative to `now` (epoch ms) as a short "Nd/h/m ago" string. */
export function formatRelativeTime(now: number, timestamp: number): string {
  // `now` is 0 on the server snapshot (useSyncExternalStore's SSR fallback,
  // before the client clock hydrates). Render a neutral placeholder until
  // `now` is real, so the first client render matches.
  if (now <= 0) return "—";
  // useNow ticks once a minute, so a write from the last minute can carry a
  // timestamp up to a minute ahead of it: that is fresh. Further ahead means
  // the clocks disagree, and "just now" would be a claim we cannot back.
  const lead = timestamp - now;
  if (lead > MAX_CLOCK_LEAD_MS) return "—";
  const diff = Math.max(0, -lead);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/**
 * `formatRelativeTime` with a leading verb ("updated 2h ago"). An unknown time
 * stays a bare "—": "updated —" would read as a value.
 */
export function formatRelativeTimeWithVerb(
  verb: string,
  now: number,
  timestamp: number,
): string {
  const time = formatRelativeTime(now, timestamp);
  return time === "—" ? time : `${verb} ${time}`;
}
