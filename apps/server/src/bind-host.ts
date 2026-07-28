/**
 * Loopback classification for the bind-auth gate.
 *
 * Both bind gates — `assertBindIsSafe` (the `dashframe serve` CLI) and
 * `assertBindAuthorized` (`createDashframeServer`) — decide whether a bind
 * needs an auth token by asking whether the host is loopback. They shared the
 * *intent* but each carried its own copy of the check, so the answer could
 * drift between the two entry points. One implementation, imported by both.
 */
import { isIPv4 } from "node:net";

/**
 * Returns true when `hostname` names a loopback interface — reachable only
 * from this machine, so a network auth token is not required.
 *
 * Loopback is: an absent hostname (the default bind is 127.0.0.1), the
 * `localhost` name, the IPv6 loopback `::1`, or any IPv4 literal in
 * 127.0.0.0/8 (RFC 3330 — the whole block, not just 127.0.0.1).
 *
 * The IPv4 test parses the value as a dotted-quad literal before looking at
 * the first octet. A bare `hostname.startsWith("127.")` prefix test is a
 * string test on a *hostname*, so it also accepts DNS names like
 * `127.attacker.example` or `127.0.0.1.evil.example`, which resolve wherever
 * their owner points them. Classifying those as loopback waives the token
 * requirement on a network-reachable bind — the exact mistake this gate
 * exists to catch. See issue #243.
 *
 * Anything that is not one of the forms above is non-loopback, so the gate
 * fails closed on ambiguity. That deliberately includes shorthand IPv4 forms
 * such as `127.1`: `getaddrinfo` widens it to 127.0.0.1, but it is not a
 * dotted-quad literal, and requiring an explicit `--token` for an unusual
 * spelling is the safe direction to be wrong in.
 */
export function isLoopbackHost(hostname: string | undefined): boolean {
  if (hostname === undefined) return true;
  if (hostname === "localhost") return true;
  if (hostname === "::1") return true;
  // `isIPv4` accepts only a four-octet dotted-quad, so `startsWith` here is
  // checking an octet boundary rather than an arbitrary string prefix.
  return isIPv4(hostname) && hostname.startsWith("127.");
}
