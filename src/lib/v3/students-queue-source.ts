import "server-only";

import { randomUUID } from "node:crypto";

import type { DocsPackagesRead, StudentsHandoff, StudentsOpenTasks, StudentsQueueParams } from "@/components/v3/students/students-queue-view";
import {
  studentsCountsView,
  studentsHandoffPending,
  studentsQueueRequest,
} from "@/components/v3/students/students-queue-view";

import { isStaffPreview, staffHasPermission } from "../platform-access";
import { getPlatformAdmissionsTaskWorkspace } from "../platform-admissions-workspace";
import { readStaffApplicationPackageQueueAction } from "../portal/application-packages-actions";
import { getHandoffAcknowledgement } from "../platform-handoff-acknowledgement";
import type { ActivePlatformActor } from "../platform-auth";
import {
  readStudentCaseQueue,
  readStudentCaseQueueCounts,
  StudentCaseQueueForbiddenError,
  type StudentCaseQueueCounts,
  type StudentCaseQueuePage,
} from "../platform-student-case-queue";

export type StudentsQueueRead = Readonly<{
  /** null — страница не прочитана: «Не удалось загрузить список» и «Повторить». */
  page: StudentCaseQueuePage | null;
  /** null — числа не прочитаны: «Счётчики недоступны, список работает». */
  counts: StudentCaseQueueCounts | null;
  /** Сервер отказал в чтении очереди: честный отказ без «Повторить». */
  forbidden: boolean;
}>;

/**
 * «Студенты» — страница очереди и числа вкладок, групп и меню (миграция
 * 241) одним заходом. Два чтения независимы: отказ чисел не гасит список, и
 * наоборот. «Нагрузка кураторов» строк дел не читает — только числа вкладок.
 */
export async function readStudentsQueue(actor: ActivePlatformActor, params: StudentsQueueParams): Promise<StudentsQueueRead> {
  const filters = {
    direction: params.direction,
    curatorMembershipId: params.curator,
    pipelineStage: params.mode === "queue" ? params.stage : null,
    query: params.query,
  };
  let forbidden = false;
  const [page, counts] = await Promise.all([
    params.view === "curators" ? Promise.resolve(null)
      : readStudentCaseQueue(actor, studentsQueueRequest(params)).catch((error: unknown) => {
        forbidden = error instanceof StudentCaseQueueForbiddenError;
        return null;
      }),
    readStudentCaseQueueCounts(actor, studentsCountsView(params), filters).catch(() => null),
  ]);
  return Object.freeze({ page, counts, forbidden });
}

/**
 * Открытые задачи дела для «Быстрого просмотра» — существующее чтение
 * `staff_student_case_task_workspace` (одно на открытую панель). Отказ —
 * «недоступно», а не «задач нет».
 */
export async function readStudentsOpenTasks(actor: ActivePlatformActor, studentCaseId: string): Promise<StudentsOpenTasks> {
  try {
    const workspace = await getPlatformAdmissionsTaskWorkspace(actor, studentCaseId);
    const open = workspace.tasks
      .filter((task) => task.status !== "done" && task.status !== "cancelled")
      .map((task) => Object.freeze({
        id: task.caseTaskId, title: task.title, status: task.status, dueOn: task.dueOn, dueAt: task.dueAt,
        assigneeDisplayName: task.assigneeDisplayName,
      }));
    return Object.freeze({ kind: "ready", tasks: Object.freeze(open) });
  } catch {
    return Object.freeze({ kind: "unavailable" });
  }
}

/**
 * «Приём дела» для «Быстрого просмотра» — существующее чтение
 * `staff_student_case_handoff_acknowledgement` (одно на открытую панель).
 * Панель показывает блок только текущему куратору, который может ответить,
 * и только пока дело не принято; отказ чтения — без блока: принять дело
 * можно из карточки дела.
 */
export async function readStudentsHandoff(actor: ActivePlatformActor, studentCaseId: string): Promise<StudentsHandoff | null> {
  try {
    const snapshot = await getHandoffAcknowledgement(actor, studentCaseId);
    return studentsHandoffPending(snapshot) ? Object.freeze({ ...snapshot, requestId: randomUUID() }) : null;
  } catch {
    return null;
  }
}

/**
 * Вкладка «Комплекты» EVO Docs (Э3, 27.09.2026): очередь «Комплекты на
 * проверку» — то же чтение и то же условие, что у шапки доски поступления
 * (`application_package_queue_v1`, первая страница; `document.read.full`, не
 * в просмотре роли). Без условия очередь не читается вовсе — вкладки нет;
 * отказ сервера и сбой — разные состояния.
 */
export async function readDocsPackages(actor: ActivePlatformActor): Promise<DocsPackagesRead> {
  if (isStaffPreview(actor) || !staffHasPermission(actor, "document.read.full")) return Object.freeze({ kind: "hidden" });
  try {
    const result = await readStaffApplicationPackageQueueAction({ organizationId: actor.organizationId, membershipId: actor.membershipId });
    if (result.ok) return Object.freeze({ kind: "ready", queue: result.queue });
    return Object.freeze({ kind: result.reason === "forbidden" ? "denied" : "error" });
  } catch {
    return Object.freeze({ kind: "error" });
  }
}
