"use server";

import { redirect } from "next/navigation";

import { exactActionStringFields } from "../server/action-form-fields.ts";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import { acceptConsentsFrom } from "./consent-gate-rpc.ts";
import { CONSENT_GATE_FIELDS, isConsentRequestId, safeConsentReturnPath } from "./consent-gate.ts";

export type ConsentGateActionState = Readonly<{ status: "idle" | "needs_both" | "unavailable" }>;

/**
 * «Продолжить» на экране «Конфиденциальность» (миграция 356, решение владельца 09.11.2026): обе галочки обязательны.
 * Студент из живой сессии; версии и источник подставляет сервер, из формы приходят только галочки, номер запроса
 * (заморожен при показе формы) и адрес возврата. Успех - переход на запрошенную страницу.
 */
export async function acceptOwnConsentsAction(
  _previous: ConsentGateActionState,
  form: FormData,
): Promise<ConsentGateActionState> {
  await requireStudentPortalActor();
  const fields = exactActionStringFields(form, CONSENT_GATE_FIELDS);
  if (!fields) return { status: "unavailable" };
  if (fields.get("policy_consent") !== "granted" || fields.get("ai_consent") !== "granted") return { status: "needs_both" };
  const requestId = fields.get("request_id");
  if (!isConsentRequestId(requestId)) return { status: "unavailable" };
  const result = await acceptConsentsFrom(createSupabaseServerClient, requestId);
  if (!result.ok) return { status: "unavailable" };
  redirect(safeConsentReturnPath(fields.get("next")));
}
