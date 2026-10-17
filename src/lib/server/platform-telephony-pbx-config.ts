import "server-only";

/**
 * Outbound (EVO → PBX) configuration for Beeline KG `crmapi/v1`
 * (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.4 and §5.5, ADR 0033).
 *
 * Three names make one group, «all or nothing», and the release env contract
 * (`scripts/evo-app-env-contract.mjs`, slice T3) already validates their shape:
 *  - EVO_PLATFORM_TELEPHONY_PBX_TOKEN — the cabinet's «Ключ для авторизации в
 *    АТС», sent as the `X-API-KEY` header; a secret;
 *  - EVO_PLATFORM_TELEPHONY_PBX_URL — the https API base, no trailing slash;
 *  - EVO_PLATFORM_TELEPHONY_PBX_HOST — the tenant host (recording links, §7.2).
 *
 * This module repeats those rules for the running process and adds the one
 * thing the env contract leaves to this slice (PLAN_CHANGES «Телефония T3»,
 * item 8): the API host must be allowed. It is allowed when it is the tenant
 * host itself or a name under `ats.beeline.kg`, the PBX platform's domain, and
 * never an address literal. Nothing here reads, logs or returns the key except
 * as the `apiKey` field of a ready configuration.
 */

// Printable ASCII only, no whitespace: the same pattern as the env contract.
export const PLATFORM_TELEPHONY_PBX_TOKEN_PATTERN = /^[\x21-\x7e]{16,256}$/u;
export const PLATFORM_TELEPHONY_PBX_HOST_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
// The PBX platform's own domain. A tenant host (`<tenant>.ats.beeline.kg`) is
// allowed even if the operator sets another PBX_HOST for recordings.
const PBX_PLATFORM_DOMAIN_SUFFIX = ".ats.beeline.kg";
const IPV4_LITERAL = /^[0-9]+(?:\.[0-9]+){3}$/u;

export type PlatformTelephonyPbxConfig = Readonly<{
  /** `https://<tenant>/crmapi/v1`, canonical, no trailing slash. */
  baseUrl: string;
  /** The API host taken from `baseUrl`. */
  apiHost: string;
  /** The tenant host for recording links. */
  recordingHost: string;
  /** The `X-API-KEY` value. A secret: never log or return it. */
  apiKey: string;
}>;

export type PlatformTelephonyPbxConfigInvalidReason =
  | "incomplete_group"
  | "invalid_token"
  | "invalid_url"
  | "invalid_host"
  | "host_not_allowed";

export type PlatformTelephonyPbxConfigState =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "invalid"; reason: PlatformTelephonyPbxConfigInvalidReason }>
  | Readonly<{ status: "ready"; config: PlatformTelephonyPbxConfig }>;

function parseBaseUrl(value: string): URL | null {
  if (value.endsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Canonical text only, so that what is written is exactly what is called.
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.port !== "" ||
    url.pathname === "/" ||
    url.href !== value
  ) {
    return null;
  }
  return url;
}

function hostAllowed(apiHost: string, recordingHost: string): boolean {
  if (IPV4_LITERAL.test(apiHost)) return false;
  return apiHost === recordingHost || apiHost.endsWith(PBX_PLATFORM_DOMAIN_SUFFIX);
}

/**
 * Reads the PBX group. `not_configured` is the normal state until the owner
 * puts the key in (plan §14, step 8): the outbound features are then off and
 * the settings screen says «Ключ ВАТС не задан». `invalid` is reported by name
 * only; the offending value is never echoed.
 */
export function readPlatformTelephonyPbxConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlatformTelephonyPbxConfigState {
  const token = environment.EVO_PLATFORM_TELEPHONY_PBX_TOKEN ?? "";
  const url = environment.EVO_PLATFORM_TELEPHONY_PBX_URL ?? "";
  const host = environment.EVO_PLATFORM_TELEPHONY_PBX_HOST ?? "";
  const present = [token, url, host].filter((value) => value !== "").length;
  if (present === 0) return Object.freeze({ status: "not_configured" });
  if (present !== 3) return Object.freeze({ status: "invalid", reason: "incomplete_group" });
  if (!PLATFORM_TELEPHONY_PBX_TOKEN_PATTERN.test(token)) {
    return Object.freeze({ status: "invalid", reason: "invalid_token" });
  }
  const parsed = parseBaseUrl(url);
  if (parsed === null) return Object.freeze({ status: "invalid", reason: "invalid_url" });
  if (!PLATFORM_TELEPHONY_PBX_HOST_PATTERN.test(host)) {
    return Object.freeze({ status: "invalid", reason: "invalid_host" });
  }
  if (!hostAllowed(parsed.hostname, host)) {
    return Object.freeze({ status: "invalid", reason: "host_not_allowed" });
  }
  return Object.freeze({
    status: "ready",
    config: Object.freeze({
      baseUrl: url,
      apiHost: parsed.hostname,
      recordingHost: host,
      apiKey: token,
    }),
  });
}
