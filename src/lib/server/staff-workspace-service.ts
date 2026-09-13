import "server-only";
import { resolvePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { studentInviteCallbackUrl } from "@/lib/student-invite-callback-contract";
import { getPlatformSupabaseBackendConfig, PlatformSupabaseBackendConfigurationError } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";
import { isStaffRole, STAFF_UUID } from "@/lib/v3/staff-workspace-contract";
import { definiteStaffAuthRejection } from "./staff-auth-failure";
import { ADMISSIONS_DIRECTIONS } from "@/lib/platform-admissions-playbook-contract";

type StaffAuthResult = { status: string; operation: string; rejection_code?: string | null };

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
    return result.data as StaffAuthResult;
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
    let providerError: unknown = null;
    try {
      // The privileged client is used for Auth and the narrow rejection receipt,
      // never platform provisioning or another business command.
      // Official API: invite sends an email; neither a success response nor an
      // Auth timestamp proves inbox delivery. Recovery timestamps are read back.
      // https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
      // https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
      if (operation === "invite") {
        const result = await authClient.auth.admin.inviteUserByEmail(claim.data.email, {
          redirectTo, data: { evo_staff_invitation_request_id: requestId },
        });
        providerError = result.error;
      } else {
        const result = await authClient.auth.resetPasswordForEmail(claim.data.email, { redirectTo });
        providerError = result.error;
      }
    } catch (error) {
      providerError = error;
      // A timeout can follow a successful email side effect. Read back, never retry.
    }
    const rejection = definiteStaffAuthRejection(providerError);
    if (rejection) {
      // The receipt RPC independently reads Auth before unlocking the recipient.
      // A failed receipt write leaves the request pending; no blind retry.
      await authClient.schema("platform").rpc("staff_workspace_record_auth_rejection", {
        p_organization_id: actor.organizationId, p_request_id: requestId,
        p_code: rejection.code, p_http_status: rejection.httpStatus,
      });
    }
  }
  const result = await client.rpc("staff_workspace_reconcile_auth", {
    p_organization_id: actor.organizationId, p_request_id: requestId,
  });
  if (result.error) throw new Error("staff_workspace_reconciliation_required");
  return result.data as StaffAuthResult;
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

function staffText(form: FormData, key: string, maximum: number, required = false): string {
  const raw = form.get(key);
  if (raw !== null && typeof raw !== "string") throw new Error("staff_workspace_invalid_input");
  const value = (raw ?? "").trim();
  if ((required && !value) || value.length > maximum) throw new Error("staff_workspace_invalid_input");
  return value;
}

function organizationalCommandInput(form: FormData) {
  const requestId = staffText(form, "request_id", 36, true);
  const rawVersion = staffText(form, "expected_version", 16, true);
  const expectedVersion = Number(rawVersion);
  if (!STAFF_UUID.test(requestId) || !/^\d+$/.test(rawVersion) || !Number.isSafeInteger(expectedVersion)) {
    throw new Error("staff_workspace_invalid_input");
  }
  return { requestId, expectedVersion, reason: staffText(form, "reason", 500, true) };
}

export class StaffMetadataOutcomeUnknownError extends Error {
  constructor() { super("staff_metadata_outcome_unknown"); }
}

function organizationalRpcError(error: { code: string; message: string }): never {
  // Explicit PostgreSQL statement failures roll the transaction back. Transport,
  // proxy and malformed responses do not prove whether the command committed.
  if (["22023", "22001", "23503", "23505", "23514", "40001", "40P01", "42501", "P0001"].includes(error.code)) {
    throw new Error(error.message);
  }
  throw new StaffMetadataOutcomeUnknownError();
}

function verifyOrganizationalReceipt(value: unknown, targetKey: "department_id" | "membership_id", targetId: string | null, expectedVersion: number): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StaffMetadataOutcomeUnknownError();
  const receipt = value as Record<string, unknown>;
  if ((receipt.status !== "applied" && receipt.status !== "replayed")
    || receipt.version !== expectedVersion + 1 || !Number.isSafeInteger(receipt.version)
    || typeof receipt[targetKey] !== "string" || !STAFF_UUID.test(receipt[targetKey])
    || (targetId !== null && receipt[targetKey] !== targetId)) {
    throw new StaffMetadataOutcomeUnknownError();
  }
}

export async function changeStaffDepartment(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const { requestId, expectedVersion, reason } = organizationalCommandInput(form);
  const operation = staffText(form, "operation", 16, true);
  const departmentId = staffText(form, "department_id", 36);
  if (!["create", "update", "archive", "restore"].includes(operation)
    || (operation === "create" ? departmentId !== "" || expectedVersion !== 0 : !STAFF_UUID.test(departmentId) || expectedVersion < 1)) {
    throw new Error("staff_workspace_invalid_input");
  }
  const editing = operation === "create" || operation === "update";
  const result = await client.rpc("staff_department_command", {
    p_organization_id: actor.organizationId, p_department_id: departmentId || null, p_operation: operation,
    p_name: editing ? staffText(form, "name", 120, true) : null,
    p_description: editing ? staffText(form, "description", 500) || null : null,
    p_expected_version: expectedVersion, p_reason: reason, p_request_id: requestId,
  }).then((response) => response, () => { throw new StaffMetadataOutcomeUnknownError(); });
  if (result.error) organizationalRpcError(result.error);
  verifyOrganizationalReceipt(result.data, "department_id", departmentId || null, expectedVersion);
}

export async function saveStaffOrganizationalDetails(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const { requestId, expectedVersion, reason } = organizationalCommandInput(form);
  const membershipId = staffText(form, "membership_id", 36, true);
  const departmentId = staffText(form, "department_id", 36);
  const directions = form.getAll("direction_codes");
  if (!STAFF_UUID.test(membershipId) || (departmentId && !STAFF_UUID.test(departmentId))
    || directions.length > ADMISSIONS_DIRECTIONS.length || new Set(directions).size !== directions.length
    || directions.some((direction) => !(ADMISSIONS_DIRECTIONS as readonly unknown[]).includes(direction))) {
    throw new Error("staff_workspace_invalid_input");
  }
  const result = await client.rpc("staff_organizational_details_save", {
    p_organization_id: actor.organizationId, p_membership_id: membershipId, p_department_id: departmentId || null,
    p_job_title: staffText(form, "job_title", 160) || null, p_direction_codes: directions,
    p_expected_version: expectedVersion, p_reason: reason, p_request_id: requestId,
  }).then((response) => response, () => { throw new StaffMetadataOutcomeUnknownError(); });
  if (result.error) organizationalRpcError(result.error);
  verifyOrganizationalReceipt(result.data, "membership_id", membershipId, expectedVersion);
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
  if (message.includes("version_conflict")) return "Данные изменились. Обновите страницу, проверьте актуальные сведения и повторите изменение.";
  if (message.includes("department_name")) return "Отдел с таким названием уже существует, в том числе среди архивных. Выберите другое название или восстановите существующий отдел.";
  if (message.includes("department_archived")) return "В этот отдел нельзя назначить сотрудника: отдел в архиве. Выберите действующий отдел или восстановите его.";
  if (message.includes("replay_conflict") || message.includes("idempotency")) return "Этот запрос уже использован для другого изменения. Обновите страницу перед новым действием.";
  if (message.includes("email_exists")) return "Для этого email уже есть аккаунт. Проверьте его принадлежность и связь с сотрудником. Восстановление доступно только уже подключённому сотруднику.";
  if (message.includes("auth_pending")) return "Для адресата уже есть запрос. Проверьте его в журнале; повторная отправка заблокирована.";
  if (message.includes("auth_cooldown")) return "Между запросами одному адресату нужна пауза не менее 60 секунд. Подождите и отправьте новый запрос явно.";
  if (message.includes("recipient_required")) return "Подтвердите, что адресат согласован и письмо можно отправить.";
  if (message.includes("reconciliation_required")) return "Результат отправки требует проверки в журнале. Не отправляйте письмо повторно.";
  if (message.includes("forbidden")) return "Действие доступно только активному администратору. Проверьте сеанс входа.";
  if (message.includes("invalid_input")) return "Проверьте имя, email, роль и обязательные поля.";
  return "Операция недоступна. Данные не подтверждены; обновите страницу и проверьте журнал запросов.";
}
