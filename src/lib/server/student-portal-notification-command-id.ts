import "server-only";

import { createHash } from "node:crypto";

const STUDENT_PORTAL_COMMAND_NAMESPACE =
  "73f89df8-d811-5352-9a97-a87652d591c1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StudentPortalNotificationCommandActor = Readonly<{
  authUserId: string;
  membershipId: string;
  organizationId: string;
  studentCaseId: string;
}>;

function canonicalUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new TypeError("invalid_uuid");
  return value.toLowerCase();
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(canonicalUuid(value).replaceAll("-", ""), "hex");
}

function uuidV5(name: string): string {
  const hash = createHash("sha1")
    .update(uuidBytes(STUDENT_PORTAL_COMMAND_NAMESPACE))
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One verified Student and one notification always address one replay-safe
 * acknowledgement command. No browser-supplied request id enters this seam.
 */
export function studentPortalNotificationReadRequestId(
  actor: StudentPortalNotificationCommandActor,
  notificationId: string,
): string {
  const authUserId = canonicalUuid(actor.authUserId);
  const membershipId = canonicalUuid(actor.membershipId);
  const organizationId = canonicalUuid(actor.organizationId);
  const studentCaseId = canonicalUuid(actor.studentCaseId);
  const canonicalNotificationId = canonicalUuid(notificationId);

  return uuidV5(
    `notification-read:${organizationId}:${studentCaseId}:${membershipId}:${authUserId}:${canonicalNotificationId}`,
  );
}
