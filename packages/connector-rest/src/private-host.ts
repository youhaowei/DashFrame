/**
 * SSRF host guard — rejects endpoint hosts that resolve to a private, loopback,
 * link-local, or otherwise non-public address.
 *
 * WHY (guard the sink, not the provenance): a REST endpoint URL is the SSRF
 * vector itself. Whether the URL was authored by a human via the config form or
 * by the assistant, an endpoint pointing at an internal host (cloud metadata at
 * 169.254.169.254, a loopback admin port, an RFC-1918 LAN service) is the same
 * attack surface. The check lives at the connector's fetch sink (and form
 * validation) so every authoring path inherits it — no caller is trusted to have
 * pre-sanitized the host.
 *
 * IMPLEMENTATION: IP classification is delegated to `ipaddr.js`, whose named
 * ranges (`private`, `loopback`, `linkLocal`, `uniqueLocal`, `carrierGradeNat`,
 * `unspecified`, `reserved`, `ipv4Mapped`) are battle-tested and auditable — a
 * hand-rolled IPv6 classifier missed the IPv4-mapped hex form (`::ffff:a9fe:a9fe`
 * = 169.254.169.254) that `URL.hostname` normalizes to. For an IPv4-mapped IPv6
 * address we re-classify the embedded IPv4 (so `::ffff:10.0.0.1` is treated as
 * the private 10.0.0.1 it is).
 *
 * SCOPE / LIMITS: this is a SYNCHRONOUS literal-host check. It blocks IP-literal
 * hosts in the non-public ranges and the obvious loopback hostnames. It does NOT
 * resolve DNS — a hostname that resolves to a private IP at fetch time (DNS
 * rebinding) is out of scope here and belongs to a fetch-time / resolved-address
 * guard, not this literal-host validator. Blocking the literal ranges is the
 * cheap, high-value floor; DNS-time defense is a separate concern.
 */

import ipaddr from "ipaddr.js";

/**
 * Strip an optional `[...]` bracket wrapper (IPv6 literal hosts in URLs are
 * bracketed, e.g. `http://[::1]/`). `URL.hostname` already removes the brackets,
 * but callers passing a raw host string may include them.
 */
function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Strip all trailing dots from a hostname (non-regex, to avoid a backtracking
 * ReDoS lint flag on `\.+$`). `localhost.`, `localhost..` etc. are the same
 * rooted FQDN as `localhost`.
 */
function stripTrailingDots(host: string): string {
  let end = host.length;
  while (end > 0 && host.charCodeAt(end - 1) === 46 /* '.' */) end--;
  return host.slice(0, end);
}

/** Loopback / unspecified hostnames that never address a public host. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * `ipaddr.js` range names that designate a non-public destination. `unicast` is
 * the only public range; everything else here is private, reserved, or a
 * loopback/link-local/CGNAT address a server-side fetch must not reach.
 */
const BLOCKED_IPV4_RANGES = new Set([
  "unspecified", // 0.0.0.0/8 — "this host"; a common loopback bypass
  "private", // 10/8, 172.16/12, 192.168/16
  "loopback", // 127/8
  "linkLocal", // 169.254/16 (cloud metadata)
  "carrierGradeNat", // 100.64/10
  "reserved", // 192.0.0/24, 240/4, etc.
  "broadcast", // 255.255.255.255/32
]);

const BLOCKED_IPV6_RANGES = new Set([
  "unspecified", // ::/128
  "loopback", // ::1/128
  "linkLocal", // fe80::/10
  "uniqueLocal", // fc00::/7
  "reserved", // various reserved blocks
]);

/** True if an `ipaddr.js`-parsed IPv4 address is in a blocked (non-public) range. */
function isBlockedIpv4(addr: ReturnType<typeof ipaddr.parse>): boolean {
  return BLOCKED_IPV4_RANGES.has(addr.range());
}

/**
 * Classify a parsed IP address as private/internal.
 *
 * For an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, however `URL` compresses it)
 * we re-classify the embedded IPv4 — `ipaddr.js` reports the wrapper as the
 * generic `ipv4Mapped` range, which would otherwise let a mapped private address
 * through. We also block the deprecated IPv4-compatible form (`::/96`,
 * e.g. `::a00:1`), which `ipaddr.js` reports as `unicast` but still embeds an
 * IPv4 destination.
 */
function isBlockedIp(addr: ReturnType<typeof ipaddr.parse>): boolean {
  if (addr.kind() === "ipv4") {
    return isBlockedIpv4(addr);
  }
  // IPv6.
  const v6 = addr as ipaddr.IPv6;
  if (v6.isIPv4MappedAddress()) {
    // Re-classify on the embedded IPv4 (::ffff:10.0.0.1 → private 10.0.0.1).
    return isBlockedIpv4(v6.toIPv4Address());
  }
  const range = v6.range();
  if (BLOCKED_IPV6_RANGES.has(range)) return true;
  // Deprecated IPv4-compatible (::/96, e.g. ::a00:1 = ::10.0.0.1) embeds an IPv4
  // destination but is reported as unicast — block when the embedded IPv4 is
  // private. The first six hextets are all zero for this form.
  const parts = v6.parts;
  const isV4Compatible =
    parts[0] === 0 &&
    parts[1] === 0 &&
    parts[2] === 0 &&
    parts[3] === 0 &&
    parts[4] === 0 &&
    parts[5] === 0 &&
    // Exclude ::/128 (unspecified) and ::1 (loopback), already handled above.
    !(parts[6] === 0 && (parts[7] === 0 || parts[7] === 1));
  if (isV4Compatible) {
    const embedded = ipaddr.fromByteArray([
      parts[6]! >> 8,
      parts[6]! & 0xff,
      parts[7]! >> 8,
      parts[7]! & 0xff,
    ]);
    return isBlockedIpv4(embedded);
  }
  return false;
}

/**
 * True if `host` (a URL hostname — IP literal or hostname) addresses a private,
 * loopback, link-local, or reserved destination that must not be reachable from
 * a server-side fetch. Used as the SSRF sink-guard in connector URL validation
 * and at the connector's fetch sink.
 *
 * @param host - A bare hostname or IP literal (e.g. from `new URL(url).hostname`).
 *               IPv6 brackets are tolerated but `URL.hostname` already strips them.
 */
export function isPrivateHost(host: string): boolean {
  // Strip ALL trailing dots: `localhost.` (and the multi-dot `localhost..`,
  // which `new URL()` also accepts) is the same host as `localhost` — a rooted
  // FQDN. Stripping only one dot would let `http://localhost../` slip past the
  // exact-match blocked-hostname set; many resolvers collapse trailing dots and
  // still resolve it to loopback. Also lets a dotted-quad with trailing dots
  // (`127.0.0.1..`) parse as the IP it is.
  const normalized = stripTrailingDots(unbracket(host.trim().toLowerCase()));
  if (normalized.length === 0) return true; // empty host is never a valid public target
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;

  // An IP literal classifies by range; a DNS hostname does not parse as an IP and
  // is treated as public (DNS-rebinding to a private IP is out of scope — see
  // module doc).
  if (ipaddr.isValid(normalized)) {
    return isBlockedIp(ipaddr.parse(normalized));
  }
  return false;
}
