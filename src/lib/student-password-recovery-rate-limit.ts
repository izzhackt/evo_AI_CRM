/**
 * In-process limiter for the public recovery form. Production runs one app
 * container (`evo-crm-app-1`), so process memory is the whole counter. Keys
 * are an IP prefix or a SHA-256 of the address, never the address itself.
 */

export type RecoveryRateLimit = Readonly<{ limit: number; windowMs: number }>;

export type RecoveryRateLimiter = Readonly<{
  /** Records one hit and answers whether it is within the limit. */
  consume(key: string, rule: RecoveryRateLimit, now?: number): boolean;
  size(): number;
}>;

const DEFAULT_MAX_KEYS = 20_000;

/** Sliding log per key, bounded in keys; oldest keys go first when full. */
export function createRecoveryRateLimiter(maxKeys = DEFAULT_MAX_KEYS): RecoveryRateLimiter {
  const hits = new Map<string, Readonly<{ windowMs: number; times: number[] }>>();

  function prune(now: number): void {
    for (const [key, entry] of hits) {
      const last = entry.times.at(-1);
      if (last === undefined || now - last >= entry.windowMs) hits.delete(key);
    }
  }

  return Object.freeze({
    consume(key: string, rule: RecoveryRateLimit, now = Date.now()): boolean {
      const times = (hits.get(key)?.times ?? []).filter((at) => now - at < rule.windowMs);
      if (times.length >= rule.limit) {
        hits.set(key, { windowMs: rule.windowMs, times });
        return false;
      }
      times.push(now);
      if (!hits.has(key) && hits.size >= maxKeys) {
        prune(now);
        while (hits.size >= maxKeys) {
          const oldest = hits.keys().next().value;
          if (oldest === undefined) break;
          hits.delete(oldest);
        }
      }
      hits.set(key, { windowMs: rule.windowMs, times });
      return true;
    },
    size: () => hits.size,
  });
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;

function ipv6Groups(value: string): string[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  return groups.every((group) => /^[0-9a-f]{1,4}$/iu.test(group)) ? groups : null;
}

/**
 * The client address added by the edge proxy. Caddy ignores an incoming
 * X-Forwarded-For from an untrusted client and sets the remote address, so
 * the last list element is the one the proxy wrote; Next fills the socket
 * address only when the header is absent. IPv6 is keyed by its /64, the
 * block one subscriber normally holds.
 *
 * @see https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults
 */
export function recoveryClientIpKey(forwardedFor: string | null | undefined): string {
  const last = (forwardedFor ?? "").split(",").at(-1)?.trim().toLowerCase() ?? "";
  const address = last.split("%")[0];
  if (IPV4.test(address)) return `ip4:${address}`;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(address);
  if (mapped && IPV4.test(mapped[1])) return `ip4:${mapped[1]}`;
  const groups = address.includes(":") ? ipv6Groups(address) : null;
  if (groups) {
    return `ip6:${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
  }
  return "ip:unknown";
}
