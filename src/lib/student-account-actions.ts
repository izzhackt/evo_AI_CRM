"use server";

import { randomUUID } from "node:crypto";

import type { ActivePlatformActor } from "./platform-auth";
import { isStaffPreview } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { parsePlatformSalesUuid } from "./platform-sales";
import { exactActionStringFields } from "./server/action-form-fields";
import { provisionStudentAccount } from "./server/student-account-provisioning";
import {
  parseStudentAccountInput,
  type StudentAccountActionState,
  type StudentAccountInput,
  type StudentCaseAccountActionState,
} from "./student-account-contract";
import { createSupabaseServerClient } from "./supabase/server";
import { findPossibleDuplicates } from "./v3/possible-duplicates";
import { STUDENT_SEARCH_READERS } from "./v3/student-search-readers";

const CASE_REFUSALS = new Set(["case_has_cabinet", "case_closed", "case_invite_exists", "case_unsupported"]);

type BeforeProvision = (actor: ActivePlatformActor, input: StudentAccountInput, requestId: string) =>
  Promise<StudentAccountActionState | null>;

/**
 * Только администратор вне просмотра роли; право ещё раз проверяет база. Повтор того же запроса (потерянный ответ) не
 * создаёт второй аккаунт; после ответа базы — новый запрос, иначе после отказа («почта занята») повтор упирался бы в
 * закрытое разрешение. Временный пароль возвращается один раз и нигде не хранится.
 */
async function provision(
  previous: Readonly<{ requestId: string }>,
  form: FormData,
  withCase: boolean,
  beforeProvision?: BeforeProvision,
): Promise<StudentCaseAccountActionState | StudentAccountActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, withCase
    ? ["request_id", "student_case_id", "first_name", "last_name", "email"]
    : ["request_id", "first_name", "last_name", "email", "confirm_duplicate"]);
  const requestId = parsePlatformSalesUuid(fields?.get("request_id")) ?? previous.requestId;
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) return { status: "forbidden", requestId };
  const studentCaseId = withCase ? parsePlatformSalesUuid(fields?.get("student_case_id")) : null;
  const input = fields && (!withCase || studentCaseId)
    ? parseStudentAccountInput(fields.get("first_name") ?? "", fields.get("last_name") ?? "", fields.get("email") ?? "")
    : null;
  if (!input) return { status: "invalid", requestId };
  // Похожий студент — до базы: запрос не тратится, «Всё равно создать» повторяет его же.
  if (beforeProvision && fields?.get("confirm_duplicate") !== "1") {
    const stop = await beforeProvision(actor, input, requestId);
    if (stop) return stop;
  }
  try {
    const client = await createSupabaseServerClient();
    const outcome = await provisionStudentAccount(client, actor.organizationId, requestId, input, studentCaseId);
    // A request that reached the database is finished either way: the next attempt is a new request.
    const next = randomUUID();
    if (outcome.status === "created") return { status: "created", requestId: next, account: outcome.account };
    if (outcome.status === "already_created") return { status: "already_created", requestId: next, login: outcome.login };
    return { status: outcome.status, requestId: next };
  } catch {
    return { status: "unavailable", requestId: randomUUID() };
  }
}

/** Студент с делом или лидом уже есть (07.11.2026): кабинет ему открывают в его деле, а не с нуля. */
async function stopOnPossibleDuplicate(
  actor: ActivePlatformActor,
  input: StudentAccountInput,
  requestId: string,
): Promise<StudentAccountActionState | null> {
  const matches = await findPossibleDuplicates(actor, input, STUDENT_SEARCH_READERS);
  return matches.length > 0 ? { status: "possible_duplicate", requestId, matches } : null;
}

/** «Настройки → Кабинеты студентов → Создать кабинет» (342, 07.11.2026): кабинет без дела. */
export async function createStudentAccountAction(
  previous: StudentAccountActionState,
  form: FormData,
): Promise<StudentAccountActionState> {
  const state = await provision(previous, form, false, stopOnPossibleDuplicate);
  // Without a case the database has no case refusals; anything else would be a contract drift.
  return CASE_REFUSALS.has(state.status) ? { status: "unavailable", requestId: state.requestId } : state as StudentAccountActionState;
}

/** «Карточка студента → Доступ к порталу → Создать кабинет» (343, 07.11.2026): кабинет сразу с этим делом. */
export async function createStudentCaseAccountAction(
  previous: StudentCaseAccountActionState,
  form: FormData,
): Promise<StudentCaseAccountActionState> {
  return provision(previous, form, true) as Promise<StudentCaseAccountActionState>;
}
