/**
 * EVO Docs в «Новом виде»: какая вкладка открыта, какие строки на ней и что говорить, когда пусто. Те же чтения и те же
 * правила, что у `buildStudentsQueueScreen` прежнего вида (числа вкладок, первая непустая вкладка, порядок «сначала дольше
 * всех ждущие»); здесь они сведены в одну чистую функцию без React.
 */
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import {
  STUDENTS_DOCS_VIEW_LABELS,
  docsInitialView,
  docsNextNonEmpty,
  docsOldestFirst,
  docsReadable,
  docsRowMatches,
  docsTabCounts,
  studentsDocsTabs,
  type DocsQueuesShown,
  type StudentsDocsView,
  type StudentsQueueParams,
  type StudentsTab,
} from "../students/students-queue-view";
import type { StudentsQueueScreenInput } from "../students/StudentsQueueScreen";

type NextTab = Readonly<{ view: StudentsDocsView; label: string; count: number }> | null;

export type DocsPlan = Readonly<{
  /** Параметры с выбранной вкладкой (без `view` в адресе — первая непустая). */
  params: StudentsQueueParams;
  view: StudentsDocsView;
  tabs: readonly StudentsTab[];
  shown: DocsQueuesShown;
  /** Дела вкладки в порядке показа и порядок: `oldest` — сначала дольше всех ждущие; `partial` — прочитано не всё. */
  rows: readonly StudentCaseQueueRow[];
  order: "oldest" | "updated" | "partial";
  complete: boolean;
  emptyTitle: string;
  /** Следующая непустая вкладка для пустоты (только у настоящей пустоты полного чтения). */
  emptyNext: NextTab;
  /** Когда работы нет ни на одной вкладке — «Все». */
  toAll: NextTab;
  next: NextTab;
}>;

/** Пусто в EVO Docs: «нет» — только при полном чтении; без права читать документы вкладки дел ничего не отберут. */
export function docsEmptyTitle(view: StudentsDocsView, filtered: boolean, complete: boolean, documents: boolean): string {
  if (view !== "all" && !documents) return "Нет доступа к документам дел — откройте «Все»";
  if (view !== "all" && !complete) return "В прочитанной части списка ничего не найдено";
  if (view === "review") return "Проверять нечего.";
  if (view === "fix") return "Исправлять нечего.";
  if (view === "missing") return "Незагруженных документов по чек-листам нет.";
  return filtered ? "Ничего не найдено" : "Дел в работе нет";
}

export function docsPlan(input: StudentsQueueScreenInput): DocsPlan {
  const { read } = input;
  const shown: DocsQueuesShown = { program: (input.program?.kind ?? "hidden") !== "hidden", packages: (input.packages?.kind ?? "hidden") !== "hidden" };
  const rows = read.page?.rows ?? [];
  const complete = read.page !== null && input.params.cursor === null && read.page.nextCursor === null;
  const counts = docsTabCounts(rows, complete, read.counts, input.packages ?? { kind: "hidden" }, input.program ?? { kind: "hidden" });
  const params = input.params.autoView ? { ...input.params, view: docsInitialView(input.params, counts, shown), autoView: false } : input.params;
  const view = params.view as StudentsDocsView;
  const next = docsNextNonEmpty(view, counts, shown);
  const toAll: NextTab = counts.all ? { view: "all", label: STUDENTS_DOCS_VIEW_LABELS.all, count: counts.all } : null;
  const matching = rows.filter((row) => docsRowMatches(view, row));
  const ordered = view === "review"
    ? docsOldestFirst(matching, (row) => row.documents?.oldestSubmittedAt, (row) => row.studentCaseId, complete)
    : { items: matching, oldestFirst: false };
  const documents = docsReadable(rows);
  const filtered = Boolean(params.query || params.direction || params.curator);
  // Ссылка на следующую непустую — у настоящей пустоты полного чтения; с поиском или фильтром — только вкладки дел.
  const emptyNext = view !== "all" && documents && complete
    ? filtered ? docsNextNonEmpty(view, counts, { program: false, packages: false }) : next ?? toAll
    : null;
  return {
    params, view, shown, complete, next, toAll, emptyNext,
    tabs: studentsDocsTabs(params, counts, shown),
    rows: ordered.items,
    order: ordered.oldestFirst ? "oldest" : view === "review" && !complete ? "partial" : "updated",
    emptyTitle: docsEmptyTitle(view, filtered, complete, documents),
  };
}
