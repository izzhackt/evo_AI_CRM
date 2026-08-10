import "server-only";

const SAFE_PROVIDER_ID_PATTERN = /^[\x21-\x7e]{1,512}$/;
const DIRECT_CHAT_ID_PATTERN = /^[1-9][0-9]{4,20}@c\.us$/;

export function isSafeWahaProviderId(value: unknown): value is string {
  return typeof value === "string" && SAFE_PROVIDER_ID_PATTERN.test(value);
}

export function isWahaDirectChatId(value: unknown): value is string {
  return typeof value === "string" && DIRECT_CHAT_ID_PATTERN.test(value);
}
