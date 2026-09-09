import "server-only";
import { resolvePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { studentInviteCallbackUrl } from "@/lib/student-invite-callback-contract";
import { getPlatformSupabaseBackendConfig, PlatformSupabaseBackendConfigurationError } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";
import { isStaffRole, STAFF_UUID } from "@/lib/v3/staff-workspace-contract";

export async function staffAdminContext() {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated" || result.actor.authorityRole !== "admin") {
    throw new Error("staff_workspace_forbidden");
  }
  return { actor: result.actor, client: (await createSupabaseServerClient()).schema("platform") };
}

export function staffAuthCallbackUrl(): string {
  // Reuse the accepted runtime origin; never trust Host, form input or redirect query.
  return new URL("/auth/staff", studentInviteCallbackUrl(
    process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN,
  )).toString();
}

export async function requestStaffAuth(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const requestId = String(form.get("request_id") ?? "");
  const operation = String(form.get("operation") ?? "");
  if (!STAFF_UUID.test(requestId) || !["invite", "recovery", "reconcile"].includes(operation)) {
    throw new Error("staff_workspace_invalid_input");
  }
  if (operation === "reconcile") {
    const result = await client.rpc("staff_workspace_reconcile_auth", {
      p_organization_id: actor.organizationId, p_request_id: requestId,
    });
    if (result.error) throw new Error(result.error.message);
    return result.data as { status: string; operation: string };
  }
  if (form.get("recipient_confirmed") !== "yes") throw new Error("staff_workspace_recipient_required");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const displayName = String(form.get("display_name") ?? "").trim();
  const role = form.get("role");
  const membershipId = String(form.get("membership_id") ?? "");
  if (operation === "invite" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320
    || !displayName || displayName.length > 160 || !isStaffRole(role))) throw new Error("staff_workspace_invalid_input");
  if (operation === "recovery" && !STAFF_UUID.test(membershipId)) throw new Error("staff_workspace_invalid_input");

  // Configuration is checked before persisting a dispatch claim.
  const redirectTo = staffAuthCallbackUrl();
  const authClient = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const claim = await client.rpc("staff_workspace_claim_auth", {
    p_organization_id: actor.organizationId, p_request_id: requestId, p_operation: operation,
    p_email: operation === "invite" ? email : null,
    p_display_name: operation === "invite" ? displayName : null,
    p_role: operation === "invite" ? role : null,
    p_membership_id: operation === "recovery" ? membershipId : null,
  });
  if (claim.error) throw new Error(claim.error.message);
  if (claim.data?.dispatch === true) {
    try {
      // The privileged client is used ONLY for Auth, never platform provisioning.
      // Official API: invite sends an email; neither a success response nor an
      // Auth timestamp proves inbox delivery. Recovery timestamps are read back.
      // https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
      // https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
      if (operation === "invite") {
        await authClient.auth.admin.inviteUserByEmail(claim.data.email, {
          redirectTo, data: { evo_staff_invitation_request_id: requestId },
        });
      } else {
        await authClient.auth.resetPasswordForEmail(claim.data.email, { redirectTo });
      }
    } catch {
      // A timeout can follow a successful email side effect. Read back, never retry.
    }
  }
  const result = await client.rpc("staff_workspace_reconcile_auth", {
    p_organization_id: actor.organizationId, p_request_id: requestId,
  });
  if (result.error) throw new Error("staff_workspace_reconciliation_required");
  return result.data as { status: string; operation: string };
}

export async function changeStaffMember(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const membershipId = String(form.get("membership_id") ?? "");
  const requestId = String(form.get("request_id") ?? "");
  const version = Number(form.get("expected_version"));
  const reason = String(form.get("reason") ?? "").trim();
  const operation = String(form.get("operation") ?? "");
  const value = String(form.get("value") ?? "");
  if (!STAFF_UUID.test(membershipId) || !STAFF_UUID.test(requestId) || !Number.isSafeInteger(version)
    || version < 1 || !reason || reason.length > 500
    || !(operation === "role" ? isStaffRole(value) : operation === "status" && ["active", "suspended"].includes(value))) {
    throw new Error("staff_workspace_invalid_input");
  }
  const result = await client.rpc("staff_workspace_change_member", {
    p_organization_id: actor.organizationId, p_membership_id: membershipId, p_expected_version: version,
    p_operation: operation, p_value: value, p_reason: reason, p_request_id: requestId,
  });
  if (result.error) throw new Error(result.error.message);
}

export function staffWorkspaceError(error: unknown): string {
  if (error instanceof PlatformSupabaseBackendConfigurationError) {
    return error.code === "missing_supabase_secret_key" || error.code === "unsafe_supabase_secret_key"
      ? "Отправка недоступна: серверный ключ Supabase Auth не настроен или недействителен. Администратору сервера нужно проверить EVO_PLATFORM_SUPABASE_SECRET_KEY."
      : "Отправка недоступна: неверно настроен адрес Supabase. Администратору сервера нужно проверить NEXT_PUBLIC_SUPABASE_URL.";
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("own membership")) return "Нельзя заблокировать собственный аккаунт администратора. Изменение должен выполнить другой администратор.";
  if (message.includes("last_admin")) return "Нельзя убрать доступ у последнего активного администратора.";
  if (message.includes("version_conflict")) return "Данные сотрудника изменились. Обновите страницу и проверьте роль и статус.";
  if (message.includes("email_exists")) return "Для этого email уже есть аккаунт. Новый аккаунт не создан; для сотрудника используйте восстановление входа.";
  if (message.includes("auth_pending")) return "Для адресата уже есть запрос. Проверьте его в журнале; повторная отправка заблокирована.";
  if (message.includes("recipient_required")) return "Подтвердите, что адресат согласован и письмо можно отправить.";
  if (message.includes("reconciliation_required")) return "Результат отправки требует проверки в журнале. Не отправляйте письмо повторно.";
  if (message.includes("forbidden")) return "Действие доступно только активному администратору. Проверьте сеанс входа.";
  if (message.includes("invalid_input")) return "Проверьте имя, email, роль и обязательные поля.";
  return "Операция недоступна. Данные не подтверждены; обновите страницу и проверьте журнал запросов.";
}
