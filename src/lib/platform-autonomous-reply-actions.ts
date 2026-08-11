"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformMessagingActor } from "./platform-guards";
import {
  PLATFORM_AUTONOMY_STAFF_CONTROL_STATES,
  type PlatformAutonomyStaffControlState,
} from "./platform-autonomous-replies";
import { setPlatformAutonomyControl } from "./server/platform-autonomous-replies-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function canonicalUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function version(value: unknown): string | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
    ? value
    : null;
}

function controlState(value: unknown): PlatformAutonomyStaffControlState | null {
  return typeof value === "string" &&
    (PLATFORM_AUTONOMY_STAFF_CONTROL_STATES as readonly string[]).includes(value)
    ? (value as PlatformAutonomyStaffControlState)
    : null;
}

function reason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 3 && normalized.length <= 500 ? normalized : null;
}

function semanticRequestId(parts: readonly string[]) {
  const digest = createHash("sha256")
    .update(JSON.stringify(["evo-platform-p5f3-control-v1", ...parts]), "utf8")
    .digest("hex");
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export async function setPlatformAutonomyControlAction(
  formData: FormData,
): Promise<void> {
  const conversationId = canonicalUuid(field(formData, "conversationId"));
  const expectedVersion = version(field(formData, "expectedVersion"));
  const state = controlState(field(formData, "controlState"));
  const boundedReason = reason(field(formData, "reason"));
  if (!conversationId || !expectedVersion || !state || !boundedReason) return;

  try {
    const actor = await requirePlatformMessagingActor();
    await setPlatformAutonomyControl(actor, {
      conversationId,
      expectedVersion,
      state,
      reason: boundedReason,
      requestId: semanticRequestId([
        actor.organizationId,
        actor.membershipId,
        conversationId,
        expectedVersion,
        state,
        boundedReason,
      ]),
    });
    revalidatePath(`/whatsapp/${conversationId}`);
  } catch {
    return;
  }
}
