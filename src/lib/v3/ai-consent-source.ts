import "server-only";

import { parseStaffAiConsent, type StaffAiConsent } from "../ai-agents/consent.ts";
import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Согласие студента на ИИ-помощников для чипа «ИИ: ...» в шапке Student 360 (миграция 320,
 * `staff_student_ai_consent_v1`; право то же, что у чтения дела целиком — `case.read.full` на это дело).
 * Любой отказ, сбой или чужая форма ответа — честное «нет чипа» (null), не падение карточки: чип сообщает,
 * но ничего не решает, решение принимает база. В просмотре роли и без организации чтения нет.
 */
export async function readCaseAiConsent(actor: ActivePlatformActor, studentCaseId: string): Promise<StaffAiConsent | null> {
  if (isStaffPreview(actor) || !UUID_PATTERN.test(studentCaseId) || !UUID_PATTERN.test(actor.organizationId)) return null;
  try {
    const { createSupabaseServerClient } = await import("../supabase/server");
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("staff_student_ai_consent_v1", {
      p_organization_id: actor.organizationId,
      p_student_case_id: studentCaseId,
    });
    if (response.error) return null;
    return parseStaffAiConsent(response.data);
  } catch {
    return null;
  }
}
