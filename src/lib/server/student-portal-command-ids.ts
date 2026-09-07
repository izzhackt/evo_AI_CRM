import "server-only";

import { createHash } from "node:crypto";

const COMMAND_NAMESPACE = "73f89df8-d811-5352-9a97-a87652d591c1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BIGINT_MAX = "9223372036854775807";

function uuidBytes(value: string): Buffer {
  if (!UUID_PATTERN.test(value)) throw new TypeError("invalid_uuid");
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function version(value: string): string {
  if (
    !/^(?:0|[1-9][0-9]{0,18})$/.test(value) ||
    (value.length === 19 && value > BIGINT_MAX)
  ) {
    throw new TypeError("invalid_generation");
  }
  return value;
}

function uuidV5(name: string): string {
  const hash = createHash("sha1")
    .update(uuidBytes(COMMAND_NAMESPACE))
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function studentPortalProvisioningRequestId(
  organizationId: string,
  studentCaseId: string,
): string {
  uuidBytes(organizationId);
  uuidBytes(studentCaseId);
  return uuidV5(`provision:${organizationId.toLowerCase()}:${studentCaseId.toLowerCase()}`);
}

export function studentPortalAttemptId(
  receiptId: string,
  kind: "initial" | "reissue",
  inviteGeneration: string,
): string {
  uuidBytes(receiptId);
  return uuidV5(
    `attempt:${kind}:${receiptId.toLowerCase()}:${version(inviteGeneration)}`,
  );
}

export function studentPortalReissueRequestId(
  receiptId: string,
  inviteGeneration: string,
): string {
  uuidBytes(receiptId);
  return uuidV5(
    `reissue:${receiptId.toLowerCase()}:${version(inviteGeneration)}`,
  );
}
