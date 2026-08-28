import {
  createHash,
  createHmac,
  createSecretKey,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const DEVELOPMENT_GATE_ROLES = [
  "admin",
  "sales",
  "admissions",
] as const;

export type DevelopmentGateRole = (typeof DEVELOPMENT_GATE_ROLES)[number];

export const DEVELOPMENT_SESSION_COOKIE = "evo_v2_dev_session";
export const DEVELOPMENT_SESSION_MAX_AGE_SECONDS = 30 * 60;

const SESSION_VERSION = 1;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_SUBMITTED_SECRET_LENGTH = 1024;
const MIN_CONFIGURED_SECRET_LENGTH = 32;
const MAX_CONFIGURED_SECRET_LENGTH = 512;
const CLOCK_SKEW_SECONDS = 30;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

type DevelopmentGateEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type DevelopmentGateProfile = Readonly<{
  identifier: string;
  role: DevelopmentGateRole;
  secret: string;
}>;

export type DevelopmentGateConfig = Readonly<{
  profiles: readonly DevelopmentGateProfile[];
  sessionSecret: string;
}>;

export type DevelopmentSession = Readonly<{
  role: DevelopmentGateRole;
  issuedAt: number;
  expiresAt: number;
}>;

export class DevelopmentGateConfigError extends Error {
  readonly code:
    | "development_gate_configuration_missing"
    | "development_gate_configuration_invalid";

  constructor(
    code:
      | "development_gate_configuration_missing"
      | "development_gate_configuration_invalid",
  ) {
    super(code);
    this.name = "DevelopmentGateConfigError";
    this.code = code;
  }
}

function requiredConfigurationValue(
  environment: DevelopmentGateEnvironment,
  name: string,
  options: Readonly<{ minLength: number; maxLength: number }>,
): string {
  const value = environment[name];
  if (value === undefined || value === "") {
    throw new DevelopmentGateConfigError(
      "development_gate_configuration_missing",
    );
  }
  if (
    value !== value.trim() ||
    value.length < options.minLength ||
    value.length > options.maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new DevelopmentGateConfigError(
      "development_gate_configuration_invalid",
    );
  }
  return value;
}

export function readDevelopmentGateConfig(
  environment: DevelopmentGateEnvironment = process.env,
): DevelopmentGateConfig {
  const sessionSecret = requiredConfigurationValue(
    environment,
    "EVO_DEV_GATE_SESSION_SECRET",
    {
      minLength: MIN_CONFIGURED_SECRET_LENGTH,
      maxLength: MAX_CONFIGURED_SECRET_LENGTH,
    },
  );

  const profiles = DEVELOPMENT_GATE_ROLES.map((role) => {
    const prefix = `EVO_DEV_GATE_${role.toUpperCase()}`;
    return {
      role,
      identifier: requiredConfigurationValue(
        environment,
        `${prefix}_IDENTIFIER`,
        { minLength: 1, maxLength: 128 },
      ),
      secret: requiredConfigurationValue(environment, `${prefix}_SECRET`, {
        minLength: MIN_CONFIGURED_SECRET_LENGTH,
        maxLength: MAX_CONFIGURED_SECRET_LENGTH,
      }),
    } satisfies DevelopmentGateProfile;
  });

  if (new Set(profiles.map(({ identifier }) => identifier)).size !== profiles.length) {
    throw new DevelopmentGateConfigError(
      "development_gate_configuration_invalid",
    );
  }

  return { profiles, sessionSecret };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeStringEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

export function authenticateDevelopmentProfile(
  config: DevelopmentGateConfig,
  identifier: string,
  secret: string,
): DevelopmentGateRole | null {
  if (
    typeof identifier !== "string" ||
    typeof secret !== "string" ||
    identifier.length === 0 ||
    secret.length === 0 ||
    identifier.length > MAX_IDENTIFIER_LENGTH ||
    secret.length > MAX_SUBMITTED_SECRET_LENGTH
  ) {
    return null;
  }

  let matchedRole: DevelopmentGateRole | null = null;
  for (const profile of config.profiles) {
    const identifierMatches = constantTimeStringEqual(
      identifier,
      profile.identifier,
    );
    const secretMatches = constantTimeStringEqual(secret, profile.secret);
    if (identifierMatches && secretMatches) matchedRole = profile.role;
  }
  return matchedRole;
}

function hmac(config: DevelopmentGateConfig, payload: string): Buffer {
  const key = createSecretKey(Buffer.from(config.sessionSecret, "utf8"));
  return createHmac("sha256", key).update(payload, "utf8").digest();
}

function isDevelopmentGateRole(value: unknown): value is DevelopmentGateRole {
  return (
    typeof value === "string" &&
    (DEVELOPMENT_GATE_ROLES as readonly string[]).includes(value)
  );
}

export function createDevelopmentSessionToken(
  config: DevelopmentGateConfig,
  role: DevelopmentGateRole,
  options: Readonly<{ now?: number; nonce?: string }> = {},
): string {
  if (!isDevelopmentGateRole(role)) {
    throw new TypeError("development_session_role_invalid");
  }

  const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
  const nonce = options.nonce ?? randomBytes(18).toString("base64url");
  if (!NONCE_PATTERN.test(nonce)) {
    throw new TypeError("development_session_nonce_invalid");
  }

  const encodedPayload = Buffer.from(
    JSON.stringify({
      v: SESSION_VERSION,
      role,
      iat: issuedAt,
      exp: issuedAt + DEVELOPMENT_SESSION_MAX_AGE_SECONDS,
      nonce,
    }),
    "utf8",
  ).toString("base64url");
  const signature = hmac(config, encodedPayload).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function verifyDevelopmentSessionToken(
  config: DevelopmentGateConfig,
  token: string,
  options: Readonly<{ now?: number }> = {},
): DevelopmentSession | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (
    encodedPayload.length === 0 ||
    !SIGNATURE_PATTERN.test(encodedSignature)
  ) {
    return null;
  }

  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  const expectedSignature = hmac(config, encodedPayload);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    const decoded = Buffer.from(encodedPayload, "base64url");
    if (decoded.toString("base64url") !== encodedPayload) return null;
    payload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  const role = payload.role;
  const issuedAt = payload.iat;
  const expiresAt = payload.exp;
  const nonce = payload.nonce;
  if (
    Object.keys(payload).length !== 5 ||
    payload.v !== SESSION_VERSION ||
    !isDevelopmentGateRole(role) ||
    typeof issuedAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    typeof nonce !== "string" ||
    !NONCE_PATTERN.test(nonce) ||
    expiresAt - issuedAt !== DEVELOPMENT_SESSION_MAX_AGE_SECONDS
  ) {
    return null;
  }

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (issuedAt > now + CLOCK_SKEW_SECONDS || expiresAt <= now) return null;

  return {
    role,
    issuedAt,
    expiresAt,
  };
}

export function developmentSessionCookieOptions({
  secure,
}: Readonly<{ secure: boolean }>) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure,
    maxAge: DEVELOPMENT_SESSION_MAX_AGE_SECONDS,
  };
}
