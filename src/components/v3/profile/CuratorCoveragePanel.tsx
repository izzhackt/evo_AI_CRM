import Link from "next/link";

import { btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { CoverageDueTime } from "./CoverageDueTime";
import { CuratorCoverageForm } from "./CuratorCoverageForm";
import type { StudentsCoverage } from "./students-facets";

/**
 * Нагрузка и замещение куратора внутри «Студентов» (24.09.2026): открывается
 * выбором куратора в фасете, без отдельной карточки. Поведение и права прежние:
 * раздел виден только при `case.curator.assign`, чтение и перенос — те же
 * `read_curator_coverage_workspace` и `CuratorCoverageForm`.
 */
function href(curatorId: string, caseId?: string, afterCaseId?: string): string {
  // `curator` держит таблицу и фасет на том же кураторе, что и раздел замещения.
  const query = new URLSearchParams({ curator: curatorId, coverage_curator: curatorId });
  if (caseId) query.set("coverage_case", caseId);
  if (afterCaseId) query.set("coverage_after", afterCaseId);
  return `/v3/profile?${query.toString()}#curator-coverage`;
}

const LINK = "inline-flex min-h-11 items-center text-sm font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg";

export function CuratorCoveragePanel({ coverage, fallbackName, requestId, today }: Readonly<{
  coverage: StudentsCoverage;
  /** Имя из списка кураторов, если чтение нагрузки недоступно. */
  fallbackName: string | null;
  requestId: string;
  /** Сегодня в Бишкеке, YYYY-MM-DD: год в дате только если он другой. */
  today: string;
}>) {
  if (coverage.kind === "hidden") return null;
  if (coverage.kind === "invalid") {
    return <section id="curator-coverage" aria-label="Замещение куратора" data-testid="v3-curator-coverage" className="border-b border-border pb-3">
      <p role="alert" className="py-2 text-sm text-fg-2">Параметры замещения не приняты. <Link href="/v3/profile" className="underline underline-offset-4">Начать выбор заново</Link>.</p>
    </section>;
  }
  const { curatorId, caseId, afterCaseId, explicit } = coverage;
  if (!curatorId) {
    return coverage.kind === "unavailable" && explicit
      ? <section id="curator-coverage" aria-label="Замещение куратора" data-testid="v3-curator-coverage" className="border-b border-border pb-3">
        <p role="alert" className="py-2 text-sm text-fg-2">Нагрузка сейчас недоступна. Это не означает, что дел или задач нет.</p>
      </section>
      : null;
  }
  const workspace = coverage.kind === "ready" ? coverage.workspace : null;
  const selected = workspace?.curators.find((curator) => curator.id === curatorId) ?? null;
  const name = selected?.name ?? fallbackName ?? "Выбранный куратор";
  return (
    <section id="curator-coverage" aria-labelledby="curator-coverage-title" data-testid="v3-curator-coverage" className="border-b border-border pb-2">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <h2 id="curator-coverage-title" className="text-base font-semibold text-fg">{name}</h2>
        {selected ? <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-2">
          <div><dt className="inline">Активных дел: </dt><dd className="inline font-mono tabular-nums text-fg">{selected.active_case_count}</dd></div>
          <div><dt className="inline">Открытых задач: </dt><dd className="inline font-mono tabular-nums text-fg">{selected.open_task_count}</dd></div>
          <div><dt className="inline">Ближайший срок: </dt><dd className="inline text-fg"><CoverageDueTime value={selected.nearest_due} today={today} /></dd></div>
          {!selected.active ? <div><dt className="sr-only">Назначение: </dt><dd className="inline">недоступен для нового назначения</dd></div> : null}
        </dl> : null}
      </div>
      {!workspace ? <p role="alert" className="py-2 text-sm text-fg-2">Нагрузка сейчас недоступна. Это не означает, что дел или задач нет. <Link href={href(curatorId, caseId ?? undefined, afterCaseId ?? undefined)} className="underline underline-offset-4">Повторить чтение</Link>.</p> : null}
      {/* One stable position for the form: a failed re-read keeps the open draft
          (CuratorCoverageForm holds its last read and blocks submission). */}
      {workspace || caseId ? <details open={explicit}>
        <summary className={`${LINK} cursor-pointer`}>Замещение куратора</summary>
        <div className="space-y-4 pb-4 pt-2">
          {workspace ? <>
            {selected ? <>
              {workspace.cases.length === 0 ? <p className="text-sm text-fg-2">На этой странице активных дел нет.</p> : <form action="/v3/profile#curator-coverage" method="get" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="curator" value={selected.id} />
                <input type="hidden" name="coverage_curator" value={selected.id} />
                {afterCaseId ? <input type="hidden" name="coverage_after" value={afterCaseId} /> : null}
                <label className="min-w-0 flex-1 basis-56"><span className={labelCls}>Найти студента</span>
                  <select name="coverage_case" defaultValue={caseId ?? ""} required className={`${inputCls} min-h-11`}>
                    <option value="">Выберите студента</option>
                    {workspace.cases.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
                    {workspace.preview && !workspace.cases.some((student) => student.id === workspace.preview!.id) ? <option value={workspace.preview.id}>{workspace.preview.name}</option> : null}
                  </select>
                </label>
                <button type="submit" className={`${btnGhostCls} min-h-11`}>Проверить перенос</button>
              </form>}
              {afterCaseId || workspace.next_case_id ? <nav aria-label="Страницы студентов куратора" className="flex flex-wrap gap-x-5">
                {afterCaseId ? <Link href={href(selected.id)} className={LINK}>К началу списка</Link> : null}
                {workspace.next_case_id ? <Link href={href(selected.id, undefined, workspace.next_case_id)} className={LINK}>Следующие студенты</Link> : null}
              </nav> : null}
            </> : null}
            {workspace.preview && workspace.preview.owner_id !== curatorId ? <div role="alert" className="space-y-2 text-sm text-fg-2">
              <p>Текущий куратор: {workspace.curators.find((curator) => curator.id === workspace.preview!.owner_id)?.name}. Старый выбор больше не подходит для переноса.</p>
              <Link href={href(workspace.preview.owner_id, workspace.preview.id)} className={`${btnGhostCls} min-h-11`}>Открыть актуальное назначение</Link>
            </div> : null}
          </> : null}
          {caseId ? <CuratorCoverageForm key={caseId} preview={workspace?.preview ?? null} curators={workspace?.curators ?? []} requestId={requestId} today={today} /> : null}
        </div>
      </details> : null}
    </section>
  );
}
