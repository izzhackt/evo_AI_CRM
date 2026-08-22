import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlatformActor } from "./platform-auth";

/**
 * Surfaces the finance blocks that stand on a case to the person whose action
 * is blocked.
 *
 * The database exposes this along two different paths, because the two
 * audiences may see different things (migration 043):
 *
 * - `admin` and `finance` pass `platform_can_read_finance_full` and may read
 *   `platform.stop_factors` directly, with the reason and the owner.
 * - `sales` and `curator` may not. `platform.case_finance_summaries()` gives
 *   them only the two facts they need to act on — that a block is standing and
 *   which action it stops — and only for the cases they are assigned to.
 *
 * Choosing the wrong path silently returns nothing, which would render as
 * "nothing is blocked". The role decides the path here so that never happens.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform case block data is unavailable.";

const FINANCE_FULL_ROLES = ["admin", "finance"] as const;
const CASE_SUMMARY_ROLES = ["sales", "curator"] as const;

export type PlatformCaseBlock = Readonly<{
  paymentObligationId: string;
  blockedAction: string;
}>;

type PlatformCaseBlockRepositoryOptions = Readonly<{
  client?: SupabaseClient;
}>;

export class PlatformCaseBlockRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCaseBlockRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformCaseBlockRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformCaseBlockRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

async function getPlatformClient(): Promise<SupabaseClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

function dedupeByObligation(
  blocks: readonly PlatformCaseBlock[],
): readonly PlatformCaseBlock[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.paymentObligationId)) return invalidShape();
    seen.add(block.paymentObligationId);
  }
  return blocks;
}

export function normalizePlatformStopFactorBlock(
  value: unknown,
  expectedOrganizationId: string,
  expectedStudentCaseId: string,
): PlatformCaseBlock {
  if (
    !isRecord(value)
    || Object.keys(value).sort().join(",")
      !== "blocked_action,organization_id,payment_obligation_id,status,student_case_id"
  ) {
    return invalidShape();
  }
  if (
    requiredUuid(value.organization_id) !== requiredUuid(expectedOrganizationId)
    || requiredUuid(value.student_case_id) !== requiredUuid(expectedStudentCaseId)
  ) {
    return invalidShape();
  }
  if (value.status !== "active") return invalidShape();
  return {
    paymentObligationId: requiredUuid(value.payment_obligation_id),
    blockedAction: requiredText(value.blocked_action, 1000),
  };
}

export function normalizePlatformCaseFinanceSummaryBlocks(
  rows: readonly unknown[],
  expectedStudentCaseId: string,
): readonly PlatformCaseBlock[] {
  const studentCaseId = requiredUuid(expectedStudentCaseId);
  const blocks: PlatformCaseBlock[] = [];
  for (const row of rows) {
    if (
      !isRecord(row)
      || !("case_id" in row)
      || !("payment_obligation_id" in row)
      || !("has_active_stop_factor" in row)
      || !("blocked_action" in row)
    ) {
      return invalidShape();
    }
    if (typeof row.has_active_stop_factor !== "boolean") return invalidShape();
    if (requiredUuid(row.case_id) !== studentCaseId) continue;
    // The summary marks a blocked obligation and names the blocked action in
    // the same row. One without the other is a shape this UI cannot trust.
    if (!row.has_active_stop_factor) {
      if (row.blocked_action !== null) return invalidShape();
      continue;
    }
    blocks.push({
      paymentObligationId: requiredUuid(row.payment_obligation_id),
      blockedAction: requiredText(row.blocked_action, 1000),
    });
  }
  return dedupeByObligation(blocks);
}

export async function listPlatformCaseBlocks(
  actor: PlatformActor,
  studentCaseId: string,
  options: PlatformCaseBlockRepositoryOptions = {},
): Promise<readonly PlatformCaseBlock[]> {
  try {
    const organizationId = requiredUuid(actor.organizationId);
    const caseId = requiredUuid(studentCaseId);
    const role = actor.platformRole;
    const client = options.client ?? await getPlatformClient();

    if ((FINANCE_FULL_ROLES as readonly string[]).includes(role)) {
      const response = await client
        .schema("platform")
        .from("stop_factors")
        .select(
          "organization_id,student_case_id,payment_obligation_id,status,blocked_action",
        )
        .eq("organization_id", organizationId)
        .eq("student_case_id", caseId)
        .eq("status", "active")
        .limit(200);
      if (response.error || !Array.isArray(response.data)) return invalidShape();
      return dedupeByObligation(
        response.data.map((value) =>
          normalizePlatformStopFactorBlock(value, organizationId, caseId)
        ),
      );
    }

    if ((CASE_SUMMARY_ROLES as readonly string[]).includes(role)) {
      const response = await client
        .schema("platform")
        .rpc("case_finance_summaries", {}, { get: true });
      if (response.error || !Array.isArray(response.data)) return invalidShape();
      return normalizePlatformCaseFinanceSummaryBlocks(response.data, caseId);
    }

    return invalidShape();
  } catch (error) {
    return failClosed(error);
  }
}
