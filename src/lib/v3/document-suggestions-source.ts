import "server-only";

import { normalizeCaseDocumentSuggestions, type CaseDocumentSuggestions } from "../document-classification.ts";
import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Подсказки ИИ по неразобранным файлам из amoCRM (миграция 333, `staff_document_suggestions_v1`). Право читать решает база
 * (case.read.full и document.read.full на дело); без согласия студента база отдаёт aiAllowed: false и пустой список.
 * Сбой, отказ или чужая форма ответа - null: вкладка честно остаётся на ручном выборе, а не падает.
 */
export async function readCaseDocumentSuggestions(actor: ActivePlatformActor, studentCaseId: string): Promise<CaseDocumentSuggestions | null> {
  if (isStaffPreview(actor) || !UUID_PATTERN.test(studentCaseId) || !UUID_PATTERN.test(actor.organizationId)) return null;
  try {
    const { createSupabaseServerClient } = await import("../supabase/server");
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("staff_document_suggestions_v1", {
      p_organization_id: actor.organizationId, p_student_case_id: studentCaseId,
    });
    if (response.error) return null;
    return normalizeCaseDocumentSuggestions(response.data);
  } catch {
    return null;
  }
}
