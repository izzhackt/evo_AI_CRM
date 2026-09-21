import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { isStudentApplicationUuid } from "../student-application-contract.ts";
import {
  isStudentSignupConfirmationEnvelope,
  STUDENT_SIGNUP_CONFIRMATION_MAX_ENVELOPE_LENGTH,
} from "../student-signup-confirmation-contract.ts";

/** Inactive item27a primitives. Only a proven new account may issue these in27b. */
export const SIGNUP_CAPABILITY_MAX_AGE_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;
const KEY_DOMAIN = "evo.student-signup-confirmation.v1";
const PAYLOAD_KEYS = ["attemptId", "authUserId", "email", "expiresAt", "issuedAt"];

export type SignupCapabilityPayload = Readonly<{
  attemptId: string;
  authUserId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type SignupCapabilityBinding = Readonly<{
  purpose: "resend" | "confirm";
  projectUrl: string;
  studentOrigin: string;
}>;

function canonicalOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return value === url.origin && !url.username && !url.password
      && (url.protocol === "https:"
        || (url.protocol === "http:" && url.hostname === "127.0.0.1"
          && Number(url.port) >= 1024 && Number(url.port) <= 65535));
  } catch { return false; }
}

function validBinding(binding: SignupCapabilityBinding, secret: string): boolean {
  return (binding.purpose === "resend" || binding.purpose === "confirm")
    && canonicalOrigin(binding.projectUrl) && canonicalOrigin(binding.studentOrigin)
    && typeof secret === "string" && secret.length >= 32 && secret.length <= 8192;
}

function validPayload(value: unknown, now: number): value is SignupCapabilityPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !Number.isSafeInteger(now) || now < 0) return false;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== PAYLOAD_KEYS.join(",")
    || !isStudentApplicationUuid(fields.attemptId) || !isStudentApplicationUuid(fields.authUserId)
    || typeof fields.email !== "string" || fields.email.length > 254
    || fields.email !== fields.email.trim().toLowerCase()
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)
    || /[\u0000-\u001f\u007f]/.test(fields.email)
    || !Number.isSafeInteger(fields.issuedAt) || !Number.isSafeInteger(fields.expiresAt)) return false;
  const { issuedAt, expiresAt } = fields as SignupCapabilityPayload;
  return issuedAt >= 0 && issuedAt <= now + CLOCK_SKEW_SECONDS
    && expiresAt > issuedAt && expiresAt > now
    && expiresAt - issuedAt <= SIGNUP_CAPABILITY_MAX_AGE_SECONDS;
}

function associatedData(binding: SignupCapabilityBinding): Buffer {
  return Buffer.from(JSON.stringify([KEY_DOMAIN, 1, binding.purpose, binding.projectUrl, binding.studentOrigin]));
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, KEY_DOMAIN, "capability-aead", 32));
}

/** The caller supplies the existing backend secret; this module reads no config. */
export function sealSignupConfirmationCapability(
  payload: SignupCapabilityPayload,
  binding: SignupCapabilityBinding,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string {
  if (!validBinding(binding, secret) || !validPayload(payload, now)) {
    throw new Error("Invalid signup confirmation capability input.");
  }
  const key = deriveKey(secret);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(associatedData(binding));
    // Copy only validated primitive fields, never invoke a caller-supplied toJSON.
    const body = JSON.stringify({
      attemptId: payload.attemptId, authUserId: payload.authUserId, email: payload.email,
      issuedAt: payload.issuedAt, expiresAt: payload.expiresAt,
    });
    const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
    const result = ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
    if (result.length > STUDENT_SIGNUP_CONFIRMATION_MAX_ENVELOPE_LENGTH) {
      throw new Error("Invalid signup confirmation capability input.");
    }
    return result;
  } finally { key.fill(0); }
}

/** Invalid, expired, differently scoped and tampered capabilities all fail closed. */
export function openSignupConfirmationCapability(
  envelope: unknown,
  binding: SignupCapabilityBinding,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): SignupCapabilityPayload | null {
  if (!validBinding(binding, secret) || !isStudentSignupConfirmationEnvelope(envelope)) return null;
  const [, noncePart, encryptedPart, tagPart] = envelope.split(".");
  const key = deriveKey(secret);
  try {
    const nonce = Buffer.from(noncePart, "base64url");
    const encrypted = Buffer.from(encryptedPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (nonce.length !== 12 || tag.length !== 16
      || nonce.toString("base64url") !== noncePart
      || encrypted.toString("base64url") !== encryptedPart
      || tag.toString("base64url") !== tagPart) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(associatedData(binding));
    decipher.setAuthTag(tag);
    const body = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return validPayload(payload, now) ? payload : null;
  } catch { return null; }
  finally { key.fill(0); }
}
