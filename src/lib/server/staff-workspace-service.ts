import "server-only";
import { randomInt } from "node:crypto";
import { resolvePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { staffInviteCallbackUrl } from "@/lib/student-invite-callback-contract";
import { getPlatformSupabaseBackendConfig, PlatformSupabaseBackendConfigurationError } from "./platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client";
import { STAFF_UUID, parseStaffAuthInput, parseStaffAuthClaim, parseStaffAuthResult, parseStaffAuthPreparation,
  parseStaffPendingAccessInput, parseStaffPendingAccessReceipt, parseStaffStatusInput, parseStaffStatusReceipt,
  staffAuthRequestId, isStaffCommandVersionRejection } from "@/lib/v3/staff-workspace-contract";
import { definiteStaffAuthRejection } from "./staff-auth-failure";
import { ADMISSIONS_DIRECTIONS } from "@/lib/platform-admissions-playbook-contract";

export class StaffAuthOutcomeUnknownError extends Error {
  readonly requestId: string;
  constructor(requestId: string) {
    super("staff_workspace_auth_outcome_unknown");
    this.requestId = requestId;
  }
}

export class StaffCommandVersionRejectedError extends Error {}

function authRpcFailure(error: { code?: string; message: string }, requestId: string): never {
  // Explicit PostgreSQL rejection rolls back the transaction. An absent or
  // transport error code cannot prove that a mutation did not commit.
  if (["22023", "23505", "23514", "42501", "40001", "55000"].includes(error.code ?? "")) throw new Error(error.message);
  throw new StaffAuthOutcomeUnknownError(requestId);
}

export async function staffAdminContext() {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated" || result.actor.systemRole !== "admin" || result.actor.presentationRole !== null) {
    throw new Error("staff_workspace_forbidden");
  }
  return { actor: result.actor, client: (await createSupabaseServerClient()).schema("platform") };
}

export function staffAuthCallbackUrl(): string {
  // Each audience has a fixed production origin; never derive it from request input.
  return staffInviteCallbackUrl(
    process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN,
  );
}

function generateStaffPassword(): string {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*+-=?"];
  const alphabet = groups.join("");
  const characters = groups.map((group) => group[randomInt(group.length)]);
  while (characters.length < 12) characters.push(alphabet[randomInt(alphabet.length)]);
  for (let index = characters.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return characters.join("");
}

export async function requestStaffAuth(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const input = parseStaffAuthInput(form, actor.organizationId);
  const { requestId, operation } = input;
  let claimObserved = false;
  const reconcile = async () => {
    let result;
    try { result = await client.rpc("staff_workspace_reconcile_auth", {
      p_organization_id: actor.organizationId, p_request_id: requestId,
    }); } catch { throw new StaffAuthOutcomeUnknownError(requestId); }
    if (result.error) {
      if (claimObserved) throw new StaffAuthOutcomeUnknownError(requestId);
      authRpcFailure(result.error, requestId);
    }
    try { return { ...parseStaffAuthResult(result.data, operation === "reconcile" ? undefined : operation), requestId,
      oneTimePassword: undefined as string | undefined }; }
    catch { throw new StaffAuthOutcomeUnknownError(requestId); }
  };
  // Reconciliation never constructs a service client or sends another message.
  if (operation === "reconcile") return reconcile();

  // Configuration is checked before persisting a dispatch claim.
  const redirectTo = operation === "password" ? undefined : staffAuthCallbackUrl();
  const authClient = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const params = {
    p_organization_id: actor.organizationId, p_request_id: requestId, p_operation: operation,
    p_email: input.operation !== "recovery" ? input.email : null,
    p_display_name: input.operation !== "recovery" ? input.displayName : null,
    p_membership_id: input.operation === "recovery" ? input.membershipId : null,
    p_assignments: input.operation !== "recovery" ? input.assignments : null,
    p_no_access: input.operation !== "recovery" ? input.noAccess : false,
    p_reason: input.reason,
    p_expected_access_version: input.operation === "recovery" ? input.expectedAccessVersion : null,
  };
  let claim;
  try { claim = await client.rpc("staff_workspace_claim_auth", params); }
  catch { throw new StaffAuthOutcomeUnknownError(requestId); }
  if (claim.error) authRpcFailure(claim.error, requestId);
  let receipt;
  try { receipt = parseStaffAuthClaim(claim.data, requestId, input.operation !== "recovery" ? input.email : undefined); }
  catch { throw new StaffAuthOutcomeUnknownError(requestId); }
  claimObserved = true;
  let oneTimePassword: string | undefined;
  if (receipt.dispatch) {
    let providerError: unknown = null;
    try {
      // The privileged client is used for Auth and the narrow rejection receipt,
      // never platform provisioning or another business command.
      // Official API: invite sends an email; neither a success response nor an
      // Auth timestamp proves inbox delivery. Recovery timestamps are read back.
      // https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
      // https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
      if (operation === "password") {
        // createUser does not send an email. Correlation is in protected app
        // metadata, which the new user cannot change. Password stays in this
        // request only; neither the ledger nor audit stores it.
        // https://supabase.com/docs/reference/javascript/auth-admin-createuser
        const password = generateStaffPassword();
        const result = await authClient.auth.admin.createUser({
          email: receipt.email, password, email_confirm: true,
          user_metadata: { display_name: input.displayName },
          app_metadata: { evo_staff_password_request_id: requestId },
        });
        providerError = result.error;
        if (!result.error && result.data.user?.email?.toLowerCase() === receipt.email
          && result.data.user.app_metadata.evo_staff_password_request_id === requestId) oneTimePassword = password;
      } else if (operation === "invite") {
        const result = await authClient.auth.admin.inviteUserByEmail(receipt.email, {
          redirectTo, data: { evo_staff_invitation_request_id: requestId },
        });
        providerError = result.error;
      } else {
        const result = await authClient.auth.resetPasswordForEmail(receipt.email, { redirectTo });
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
      try {
        const recorded = await authClient.schema("platform").rpc("staff_workspace_record_auth_rejection", {
          p_organization_id: actor.organizationId, p_request_id: requestId,
          p_code: rejection.code, p_http_status: rejection.httpStatus,
        });
        if (recorded.error) throw new StaffAuthOutcomeUnknownError(requestId);
        parseStaffAuthResult(recorded.data, operation);
      } catch { throw new StaffAuthOutcomeUnknownError(requestId); }
    }
  }
  const result = await reconcile();
  return { ...result, oneTimePassword: result.status === "completed" ? oneTimePassword : undefined };
}

export async function readStaffAuthPreparation(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const requestId = staffAuthRequestId(form);
  const result = await client.rpc("staff_workspace_auth_preparation", {
    p_organization_id: actor.organizationId, p_request_id: requestId,
  });
  if (result.error) throw new Error("staff_workspace_preparation_unavailable");
  return parseStaffAuthPreparation(result.data, { requestId, organizationId: actor.organizationId });
}

export async function prepareStaffPendingAccess(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const input = parseStaffPendingAccessInput(form, actor.organizationId);
  let result;
  try { result = await client.rpc("staff_workspace_prepare_pending_access", {
    p_organization_id: actor.organizationId, p_request_id: input.requestId,
    p_expected_preparation_version: input.expectedPreparationVersion,
    p_assignments: input.assignments, p_no_access: input.noAccess, p_reason: input.reason,
    p_command_request_id: input.commandRequestId,
  }); } catch { throw new StaffAuthOutcomeUnknownError(input.requestId); }
  if (result.error) {
    if (isStaffCommandVersionRejection("preparation", result.error)) throw new StaffCommandVersionRejectedError(result.error.message);
    authRpcFailure(result.error, input.requestId);
  }
  try { parseStaffPendingAccessReceipt(result.data, input.requestId, input.expectedPreparationVersion); }
  catch { throw new StaffAuthOutcomeUnknownError(input.requestId); }
  // Preparation only changes the recorded proposal; never claim or call Auth.
  return { requestId: input.requestId };
}

export async function changeStaffMember(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const input = parseStaffStatusInput(form);
  let result;
  try { result = await client.rpc("staff_workspace_change_member", {
    p_organization_id: actor.organizationId, p_membership_id: input.membershipId, p_expected_version: input.expectedVersion,
    p_operation: "status", p_value: input.status, p_reason: input.reason, p_request_id: input.requestId,
  }); } catch { throw new StaffAuthOutcomeUnknownError(input.requestId); }
  if (result.error) {
    if (isStaffCommandVersionRejection("status", result.error)) throw new StaffCommandVersionRejectedError(result.error.message);
    authRpcFailure(result.error, input.requestId);
  }
  try { parseStaffStatusReceipt(result.data, { ...input, organizationId: actor.organizationId }); }
  catch { throw new StaffAuthOutcomeUnknownError(input.requestId); }
  return { requestId: input.requestId };
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
  if (message.includes("rights_required")) return "Проверьте и подтвердите выбранные права сотрудника.";
  if (message.includes("explicit_access") || message.includes("prepared_access")) return "Выберите права либо явно подтвердите создание аккаунта без рабочего доступа.";
  if (message.includes("invalid_input") || message.includes("invalid_assignments")) return "Проверьте имя, email, назначения и обязательные поля.";
  return "Операция недоступна. Данные не подтверждены; обновите страницу и проверьте журнал запросов.";
}
