import "server-only";

import type { CaseWorkChat, CaseWorkRead, CaseWorkRow, CaseWorkTasks } from "@/components/v3/profile/case-work-view";
import { caseChatWork, caseOpenTasks } from "@/components/v3/profile/case-work-view";

import { hasOpenAccountDeletionRequestForCase } from "../platform-account-deletion";
import { readCaseAttentionFlags } from "../platform-admissions";
import type { AdmissionsAttention } from "../platform-admissions-playbook-contract";
import { getPlatformAdmissionsTaskWorkspace } from "../platform-admissions-workspace";
import { isStaffPreview, staffHasPermission } from "../platform-access";
import type { ActivePlatformActor } from "../platform-auth";
import { readStudentCaseQueue, STUDENT_CASE_QUEUE_PAGE_SIZE_MAX, STUDENT_CASE_QUEUE_QUERY_MAX_LENGTH } from "../platform-student-case-queue";
import { dayInOrganizationTimezone } from "../platform-task-deadline";
import { CaseChatReadError, readCaseChatPage } from "./case-chat-source";

type CaseWorkTarget = Readonly<{
  studentCaseId: string;
  studentDisplayName: string;
  state: "pending" | "active" | "closed";
}>;

/**
 * Строка этого дела в очереди 241 — то же чтение, что у «Студентов» и
 * «Быстрого просмотра» (этап, срок шага, версия для редактора, флаги).
 * Отдельного чтения одного дела у 241 нет, поэтому очередь читается видом по
 * состоянию дела и поиском по имени, а строка выбирается по id. Не нашлась
 * (отказ 241, больше 100 совпадений по имени) — null: этапа и редактора шага
 * нет, а не выдуманы.
 */
async function readCaseQueueRow(actor: ActivePlatformActor, target: CaseWorkTarget): Promise<CaseWorkRow> {
  const query = target.studentDisplayName.trim();
  if (!query || Array.from(query).length > STUDENT_CASE_QUEUE_QUERY_MAX_LENGTH) return null;
  try {
    const page = await readStudentCaseQueue(actor, {
      view: target.state, sort: "due", pageSize: STUDENT_CASE_QUEUE_PAGE_SIZE_MAX, query,
    });
    return page.rows.find((row) => row.studentCaseId === target.studentCaseId) ?? null;
  } catch {
    return null;
  }
}

/** Открытые задачи дела — существующее чтение `staff_student_case_task_workspace`. */
async function readCaseTasks(actor: ActivePlatformActor, target: CaseWorkTarget): Promise<CaseWorkTasks> {
  try {
    const workspace = await getPlatformAdmissionsTaskWorkspace(actor, target.studentCaseId);
    return Object.freeze({
      kind: "ready",
      tasks: caseOpenTasks(workspace.tasks, target.studentDisplayName, target.state),
      assignees: Object.freeze(workspace.assignees.map(({ membershipId, displayName }) => Object.freeze({ membershipId, displayName }))),
    });
  } catch {
    return Object.freeze({ kind: "unavailable" });
  }
}

/**
 * Последнее сообщение переписки — `case_chat_read_page_v1` (STABLE, ничего не
 * пишет: отметку о прочтении ставит только открытая переписка). Отказ права
 * — «нет доступа», сбой — «недоступно».
 */
async function readCaseChat(actor: ActivePlatformActor, target: CaseWorkTarget): Promise<CaseWorkChat> {
  try {
    return caseChatWork(await readCaseChatPage(actor, target.studentCaseId, "latest"), actor.membershipId);
  } catch (error) {
    return Object.freeze({ kind: error instanceof CaseChatReadError && error.status === "forbidden" ? "forbidden" : "unavailable" });
  }
}

const NOT_READ = Object.freeze({ kind: "unavailable" } as const);

/**
 * Всё, что вид дела читает сверх профиля, одним параллельным заходом. Каждое
 * чтение падает отдельно и называет своё «недоступно»; права проверяет
 * сервер — здесь только подсказки, какие чтения вообще имеют смысл. Строку
 * фактов видно на каждой вкладке; задачи и переписку показывает только
 * «Обзор», поэтому на других вкладках они не читаются.
 */
export async function readCaseWork(
  actor: ActivePlatformActor,
  target: CaseWorkTarget,
  options: Readonly<{ overview: boolean }>,
): Promise<CaseWorkRead> {
  const now = new Date();
  const [row, tasks, chat, deletionRequested] = await Promise.all([
    readCaseQueueRow(actor, target),
    options.overview ? readCaseTasks(actor, target) : NOT_READ,
    options.overview ? readCaseChat(actor, target) : NOT_READ,
    hasOpenAccountDeletionRequestForCase(actor, target.studentCaseId),
  ]);
  // «Нужен куратор» — флаг строки очереди (как в списке); без строки тот, кто назначает
  // кураторов (Admin и `case.curator.assign`, миграция 248), читает его отдельно (182).
  const needsCurator = row ? row.attentionFlags.includes("needs_curator")
    : !isStaffPreview(actor) && staffHasPermission(actor, "case.curator.assign")
      ? (await readCaseAttentionFlags(actor, target.studentCaseId).catch((): readonly AdmissionsAttention[] => [])).includes("needs_curator")
      : false;
  return Object.freeze({
    row, tasks, chat, needsCurator, deletionRequested,
    today: dayInOrganizationTimezone(now),
    nowIso: now.toISOString(),
  });
}
