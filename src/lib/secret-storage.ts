import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTED_SETTING_PREFIX = "enc:v1:";

function encryptionKey(): Buffer | null {
  const raw =
    process.env.EVO_SECRET_ENCRYPTION_KEY ||
    (process.env.NODE_ENV === "production" ? undefined : process.env.AUTH_SECRET);
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

export function encryptRuntimeSecret(name: string, value: string): string {
  if (!value) return value;
  const secret = encryptionKey();
  if (!secret) throw new Error("secret_encryption_unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  cipher.setAAD(Buffer.from(name));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_SETTING_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptRuntimeSecret(name: string, value: string): string | null {
  if (!value.startsWith(ENCRYPTED_SETTING_PREFIX)) {
    return process.env.NODE_ENV === "production" && value ? null : value;
  }
  const secret = encryptionKey();
  if (!secret) return null;
  const payload = value.slice(ENCRYPTED_SETTING_PREFIX.length);
  const [ivText, tagText, encryptedText] = payload.split(".");
  if (!ivText || !tagText || !encryptedText) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(ivText, "base64url"));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
