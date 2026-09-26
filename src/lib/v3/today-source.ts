import "server-only";

import type { PipelineLead } from "../../components/v3/Pipeline.tsx";
import { dayInOrganizationTimezone } from "../platform-task-deadline.ts";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import type { PlatformAdmissionsTaskQueueCursor, PlatformAdmissionsTaskQueueRow } from "../platform-admissions-task-contract.ts";
import type { CaseChatThreadRow } from "../platform-case-chat-contract.ts";
import type { StaffTask, StaffTaskCursor } from "../platform-staff-task-contract.ts";
import type { StudentCaseQueuePage, StudentCaseQueueRequest } from "../platform-student-case-queue-contract.ts";
import { shiftDay } from "../../components/v3/calendar/types.ts";
import { CASE_QUEUE_PAGE_SIZE, TASK_QUEUE_READ_PAGES, taskQueueAccess } from "./staff-task-source.ts";
import {
  TODAY_HORIZON_DAYS,
  todayChatItems,
  todayHandoffItems,
  todayLeadItems,
  todayRequestItems,
  todayStudentItems,
  todayTaskItems,
  type TodaySource,
  type TodaySourceRead,
} from "./today-queue.ts";

/**
 * Чтения «Сегодня» — только существующие: те же функции и параметры, что у
 * «Задач», «Студентов» (241/242), доски продаж и «Сообщений». Каждый источник
 * читается независимо: ошибка одного не прячет остальные. Права — подсказка
 * интерфейса; строки отбирает сервер.
 */

/** Сервер отказал в чтении (не сбой): источник не относится к роли, «Повторить» не поможет. */
export class TodaySourceDenied extends Error {
  constructor() {
    super("Today source is not readable for this role.");
    this.name = "TodaySourceDenied";
  }
}

export type TodayReaders = Readonly<{
  listStaffTasks: (actor: ActivePlatformActor, options: Readonly<{ view: "mine"; status: "active"; cursor: StaffTaskCursor | null }>) =>
    Promise<Readonly<{ rows: readonly StaffTask[]; nextCursor: StaffTaskCursor | null }>>;
  listCaseTasks: (actor: ActivePlatformActor, options: Readonly<{ pageSize: number; cursor: PlatformAdmissionsTaskQueueCursor | null; dueTo: string }>) =>
    Promise<Readonly<{ rows: readonly PlatformAdmissionsTaskQueueRow[]; nextCursor: PlatformAdmissionsTaskQueueCursor | null }>>;
  /** Отказ сервера — `TodaySourceDenied`. */
  readStudentCaseQueue: (actor: ActivePlatformActor, request: StudentCaseQueueRequest) => Promise<StudentCaseQueuePage>;
  readLeads: (actor: ActivePlatformActor, assignment: "mine" | "unassigned") => Promise<Readonly<{ leads: readonly PipelineLead[]; truncated: boolean }>>;
  /** Отказ сервера — `TodaySourceDenied`. */
  readChats: (actor: ActivePlatformActor) => Promise<Readonly<{ rows: readonly CaseChatThreadRow[]; truncated: boolean }>>;
}>;

/** Одно чтение 241/242 на вид: 100 дел по сроку, как самая длинная страница очереди. */
export const TODAY_STUDENT_PAGE_SIZE = 100;

async function productionReaders(): Promise<TodayReaders> {
  const [staff, workspace, queue, pipeline, chat] = await Promise.all([
    import("../server/platform-staff-task-repository.ts"),
    import("../platform-admissions-workspace.ts"),
    import("../platform-student-case-queue.ts"),
    import("./pipeline-source.ts"),
    import("./case-chat-source.ts"),
  ]);
  return {
    listStaffTasks: (actor, options) => staff.listStaffTasks(actor, options),
    listCaseTasks: (actor, options) => workspace.listPlatformAdmissionsTaskQueue(actor, options),
    readStudentCaseQueue: async (actor, request) => {
      try {
        return await queue.readStudentCaseQueue(actor, request);
      } catch (error) {
        if (error instanceof queue.StudentCaseQueueForbiddenError) throw new TodaySourceDenied();
        throw error;
      }
    },
    readLeads: (actor, assignment) => pipeline.readPipelineLeads(actor, {
      query: null, stage: "all", due: "all", assignment, ownerMembershipId: null,
    }),
    readChats: async (actor) => {
      try {
        return await chat.readStaffCaseChatThreads(actor, null, "needs_reply");
      } catch (error) {
        if (error instanceof chat.CaseChatReadError && error.status === "forbidden") throw new TodaySourceDenied();
        throw error;
      }
    },
  };
}

export type TodayAccess = Readonly<{
  /** Источники роли в порядке очереди. */
  sources: readonly TodaySource[];
  /** Назначает и замещает кураторов: видит «нужен куратор». */
  coverage: boolean;
  /** Просмотр роли: лиды не читаются (их проекция отказывает просмотру). */
  preview: boolean;
}>;

/**
 * Какие источники относятся к смотрящему — по тем же правилам, что меню и
 * страницы: задачи — как у «Задач» (`taskQueueAccess`), студенты — как у
 * очереди «Студентов» (поступление и полное чтение дел), лиды и заявки —
 * чтение продаж, переписки — «Сообщения» (поступление).
 */
export function todayAccess(actor: ActivePlatformActor): TodayAccess {
  const tasks = taskQueueAccess(actor);
  const preview = isStaffPreview(actor);
  const admissions = staffPresentationCan(actor, "admissions.read");
  const students = admissions && staffHasPermission(actor, "case.read.full");
  const sales = staffPresentationCan(actor, "sales.read");
  const sources: TodaySource[] = [];
  if (tasks.canReadStaffTasks || tasks.canReadCaseTasks) sources.push("tasks");
  if (students) sources.push("students", "handoffs");
  if (sales) sources.push("leads", "requests");
  if (admissions) sources.push("chats");
  return Object.freeze({
    sources: Object.freeze(sources),
    coverage: !preview && staffHasPermission(actor, "case.curator.assign"),
    preview,
  });
}

type Pages<Row> = Readonly<{ rows: readonly Row[]; complete: boolean }>;

/** Страницы по курсору до конца или до предела; упёрлось — чтение неполное. */
async function readPages<Row, Cursor>(
  limit: number,
  page: (cursor: Cursor | null) => Promise<Readonly<{ rows: readonly Row[]; nextCursor: Cursor | null }>>,
): Promise<Pages<Row>> {
  const rows: Row[] = [];
  let cursor: Cursor | null = null;
  for (let index = 0; index < limit; index += 1) {
    const result = await page(cursor);
    rows.push(...result.rows);
    cursor = result.nextCursor;
    if (!cursor) return { rows, complete: true };
  }
  return { rows, complete: false };
}

async function settle(source: TodaySource, read: () => Promise<TodaySourceRead>): Promise<TodaySourceRead> {
  try {
    return await read();
  } catch (error) {
    return { source, state: error instanceof TodaySourceDenied ? "denied" : "error" };
  }
}

export type TodayRead = Readonly<{
  access: TodayAccess;
  reads: readonly TodaySourceRead[];
}>;

/**
 * Все чтения «Сегодня» параллельно. Задачи — те же, что у «Задач» вида
 * «Мои»: рабочие (`staff_task_list`, 4 страницы по 50) и по студентам
 * (`staff_case_task_queue`, 3 страницы по 100 со сроком до сегодня + 14
 * дней). Студенты — одна страница вида «Мои» и одна «Требуют действия»
 * (241/242). Лиды и заявки — чтение доски продаж с `assignment=mine` и
 * `unassigned`; переписки — очередь «Нужен ответ» «Сообщений».
 */
export async function readTodayQueue(
  actor: ActivePlatformActor,
  options: Readonly<{ now: Date; readers?: TodayReaders }>,
): Promise<TodayRead> {
  const access = todayAccess(actor);
  const readers = options.readers ?? await productionReaders();
  const today = dayInOrganizationTimezone(options.now);
  const taskAccess = taskQueueAccess(actor);

  const read = (source: TodaySource): Promise<TodaySourceRead> => settle(source, async () => {
    switch (source) {
      case "tasks": {
        const [staff, cases] = await Promise.all([
          taskAccess.canReadStaffTasks
            ? readPages(TASK_QUEUE_READ_PAGES.staff, (cursor: StaffTaskCursor | null) => readers.listStaffTasks(actor, { view: "mine", status: "active", cursor }))
            : Promise.resolve({ rows: [], complete: true }),
          taskAccess.canReadCaseTasks
            ? readPages(TASK_QUEUE_READ_PAGES.case, (cursor: PlatformAdmissionsTaskQueueCursor | null) =>
              readers.listCaseTasks(actor, { pageSize: CASE_QUEUE_PAGE_SIZE, cursor, dueTo: shiftDay(today, TODAY_HORIZON_DAYS) }))
            : Promise.resolve({ rows: [], complete: true }),
        ]);
        return {
          source, state: staff.complete && cases.complete ? "complete" : "partial",
          items: todayTaskItems({ staff: staff.rows, cases: cases.rows, actorMembershipId: actor.membershipId, now: options.now }),
        };
      }
      case "students": {
        const page = await readers.readStudentCaseQueue(actor, { view: "mine", sort: "due", pageSize: TODAY_STUDENT_PAGE_SIZE });
        return { source, state: page.nextCursor ? "partial" : "complete", items: todayStudentItems(page.rows, page.today) };
      }
      case "handoffs": {
        const page = await readers.readStudentCaseQueue(actor, { view: "needs_action", sort: "due", pageSize: TODAY_STUDENT_PAGE_SIZE });
        return { source, state: page.nextCursor ? "partial" : "complete", items: todayHandoffItems(page.rows, { coverage: access.coverage }) };
      }
      case "leads":
      case "requests": {
        // Проекция передач отказывает просмотру роли: лиды он не видит, это не сбой.
        if (access.preview) return { source, state: "preview" };
        const board = await readers.readLeads(actor, source === "leads" ? "mine" : "unassigned");
        return {
          source, state: board.truncated ? "partial" : "complete",
          items: source === "leads" ? todayLeadItems(board.leads, today) : todayRequestItems(board.leads),
        };
      }
      case "chats": {
        const threads = await readers.readChats(actor);
        return { source, state: threads.truncated ? "partial" : "complete", items: todayChatItems(threads.rows) };
      }
    }
  });

  return Object.freeze({ access, reads: Object.freeze(await Promise.all(access.sources.map(read))) });
}
