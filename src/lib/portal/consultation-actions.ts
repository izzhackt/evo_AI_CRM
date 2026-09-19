"use server";

import { revalidatePath } from "next/cache";

import { universityUuid } from "../platform-university-catalog";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import {
  CONSULTATION_NOTE_LIMIT,
  parseConsultationReceipt,
  type ConsultationActionResult,
} from "./consultation";

/**
 * Отправка запроса консультации (PORT-5b, миграция 197). RPC идемпотентен по
 * request_id и держит не более одного открытого запроса на участника: повтор
 * нажатия и retry сети возвращают существующий receipt, дубль невозможен.
 * Реальная граница — в RPC; здесь транспорт и строгий разбор.
 */
export async function createConsultationRequestAction(
  requestId: unknown,
  institutionId: unknown,
  note: unknown,
): Promise<ConsultationActionResult> {
  await requireStudentPortalActor();
  const id = universityUuid(requestId);
  const institution = institutionId === null ? null : universityUuid(institutionId);
  if (!id
    || (institutionId !== null && institution === null)
    || (note !== null && typeof note !== "string")) {
    return { ok: false };
  }
  const trimmed = note === null ? null : note.trim();
  const normalizedNote = trimmed === "" ? null : trimmed;
  if (normalizedNote !== null && normalizedNote.length > CONSULTATION_NOTE_LIMIT) {
    return { ok: false };
  }
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("create_portal_consultation_request_v1", {
        p_request_id: id,
        p_institution_id: institution,
        p_note: normalizedNote,
      });
    if (error) return { ok: false };
    const receipt = parseConsultationReceipt(data);
    if (receipt === null) return { ok: false };
    revalidatePath("/portal/profile");
    return { ok: true, receipt };
  } catch {
    return { ok: false };
  }
}
