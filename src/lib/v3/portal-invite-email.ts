import type { createSupabaseServerClient } from "../supabase/server";

/**
 * Почта клиента для приглашения в кабинет у дела без открытого лида. Блок «Доступ к порталу» с этим
 * адресом видит Admin, поэтому у остальных адрес не читается вовсе, а не только не рисуется.
 */
export async function portalInviteEmailFor(
  systemRole: string,
  readClientEmail: () => Promise<string | null>,
): Promise<string | null> {
  return systemRole === "admin" ? readClientEmail() : null;
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
