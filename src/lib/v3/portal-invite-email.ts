import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import type { createSupabaseServerClient } from "../supabase/server";

/**
 * Почта клиента для приглашения в кабинет у дела без открытого лида. Блок «Доступ к порталу» с этим
 * адресом видит только настоящий Admin, поэтому у остальных адрес не читается вовсе, а не только не
 * рисуется. Админ в просмотре под другой ролью тоже не читает: блок ему не показывают (`!preview`).
 */
export async function portalInviteEmailFor(
  actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">,
  readClientEmail: () => Promise<string | null>,
): Promise<string | null> {
  return actor.systemRole === "admin" && !isStaffPreview(actor) ? readClientEmail() : null;
}

/** Почта клиента этого дела под сессией сотрудника, права решает RLS. Сбой или пустая почта: null. */
export async function readCaseClientEmail(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  studentCaseId: string,
): Promise<string | null> {
  const caseRow = await client.schema("platform").from("student_cases").select("canonical_client_id")
    .eq("organization_id", organizationId).eq("id", studentCaseId).maybeSingle();
  const clientId = caseRow.data?.canonical_client_id;
  if (caseRow.error || typeof clientId !== "string") return null;
  const clientRow = await client.schema("platform").from("clients").select("email")
    .eq("organization_id", organizationId).eq("id", clientId).maybeSingle();
  const email = clientRow.data?.email;
  if (clientRow.error || typeof email !== "string") return null;
  return email.trim() || null;
}

/**
 * Адрес считается подтверждённым, только если сам студент указал его в одобренной анкете. Всё остальное
 * пришло из карточки клиента, которую набирает сотрудник: опечатка отдаст кабинет чужому человеку.
 */
export function inviteEmailConfirmed(
  email: string | null,
  application: Readonly<{ status: string; email: string }> | null | undefined,
): boolean {
  if (!email || application?.status !== "approved") return false;
  return application.email.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * Показывать ли «Приглашение уйдёт на …» после ответа действия. Пока форма остаётся рабочей (в том числе
 * при `blocked`: «остановлено, письмо не отправлялось»), адрес виден. Приглашение уже выдано или ждёт
 * регистрации: оно живёт со своим адресом, и «уйдёт на» больше не про него.
 */
export function inviteAddressVisible(status: string | undefined): boolean {
  return status === undefined || ["invalid", "unavailable", "inviteFailed", "forbidden", "blocked"].includes(status);
}
