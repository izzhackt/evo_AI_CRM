import "server-only";

/**
 * Telephony (Beeline KG PBX) intake configuration — docs/EVO_TELEPHONY_PLAN
 * §5.1 and §5.5. The PBX has no message signature: the only secret is the
 * `crm_token` the owner types into the cabinet's «Ваша CRM» connection, so the
 * format is fixed and strict, and rotation keeps two values valid at once.
 */

// Same format as the keys the cabinet form shows: a UUID or 64 hex characters,
// which needs no encoding in a form field. No whitespace, no control
// characters, nothing outside [A-Za-z0-9-].
export const PLATFORM_TELEPHONY_CRM_TOKEN_PATTERN = /^[A-Za-z0-9-]{32,64}$/u;

export type PlatformTelephonyCrmTokens = Readonly<{
  current: string;
  /** Only while a rotation is in flight (§5.5); never equal to `current`. */
  next: string | null;
}>;

/**
 * The owner's switch for storing `event`, `history` and `rating`. Exactly "1"
 * opens it; empty, "0" and everything else keep it closed. `contact` is
 * answered independently of it (§5.1, step 6).
 */
export function isPlatformTelephonyEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.EVO_PLATFORM_TELEPHONY_ENABLED === "1";
}

function wellFormed(value: string | undefined): value is string {
  return value !== undefined && PLATFORM_TELEPHONY_CRM_TOKEN_PATTERN.test(value);
}

/**
 * The accepted intake keys, or null when none is usable (the route then answers
 * 503 before reading the body). A malformed or duplicate `…_NEXT` is ignored
 * rather than blocking a valid current key; the release env contract refuses
 * such a file before it ships.
 */
export function readPlatformTelephonyCrmTokens(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlatformTelephonyCrmTokens | null {
  const current = environment.EVO_PLATFORM_TELEPHONY_CRM_TOKEN;
  if (!wellFormed(current)) return null;
  const next = environment.EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT;
  return Object.freeze({
    current,
    next: wellFormed(next) && next !== current ? next : null,
  });
}
