import "server-only";

import type { StudentsOpenTasks, StudentsQueueParams } from "@/components/v3/students/students-queue-view";
import {
  studentsCountsView,
  studentsQueueRequest,
} from "@/components/v3/students/students-queue-view";

import { getPlatformAdmissionsTaskWorkspace } from "../platform-admissions-workspace";
import type { ActivePlatformActor } from "../platform-auth";
import {
  readStudentCaseQueue,
  readStudentCaseQueueCounts,
  type StudentCaseQueueCounts,
  type StudentCaseQueuePage,
} from "../platform-student-case-queue";

export type StudentsQueueRead = Readonly<{
  /** null — страница не прочитана: «Не удалось загрузить список» и «Повторить». */
  page: StudentCaseQueuePage | null;
  /** null — числа не прочитаны: «Счётчики недоступны, список работает». */
  counts: StudentCaseQueueCounts | null;
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
  const [page, counts] = await Promise.all([
    params.view === "curators" ? Promise.resolve(null)
      : readStudentCaseQueue(actor, studentsQueueRequest(params)).catch(() => null),
    readStudentCaseQueueCounts(actor, studentsCountsView(params), filters).catch(() => null),
  ]);
  return Object.freeze({ page, counts });
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
