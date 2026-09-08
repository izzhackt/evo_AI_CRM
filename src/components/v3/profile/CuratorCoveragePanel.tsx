import { randomUUID } from "node:crypto";

import Link from "next/link";

import { btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { PlatformActor } from "@/lib/platform-auth";
import { coverageDeadlineLabel, parseCoverageUuid } from "@/lib/platform-case-coverage-contract";
import { readCuratorCoverageWorkspace } from "@/lib/server/curator-coverage-source";

import { CuratorCoverageForm } from "./CuratorCoverageForm";

type Query = Readonly<Record<string, string | readonly string[] | undefined>>;
function href(curatorId: string, caseId?: string, afterCaseId?: string): string {
  const query = new URLSearchParams({ coverage_curator: curatorId });
  if (caseId) query.set("coverage_case", caseId);
  if (afterCaseId) query.set("coverage_after", afterCaseId);
  return `/v3/profile?${query.toString()}#curator-coverage`;
}

export async function CuratorCoveragePanel({ actor, params }: Readonly<{ actor: PlatformActor; params: Query }>) {
  if (actor.authorityRole !== "admin") return null;
  const requested = [params.coverage_curator, params.coverage_case, params.coverage_after];
  const parsed = requested.map((value) => value === undefined ? undefined : parseCoverageUuid(value));
  const [curatorId, caseId, afterCaseId] = parsed;
  const invalid = parsed.includes(null) || Boolean((caseId || afterCaseId) && !curatorId);
  let workspace = null;
  if (!invalid) {
    try {
      workspace = await readCuratorCoverageWorkspace(actor, {
        curatorId: curatorId ?? undefined, caseId: caseId ?? undefined, afterCaseId: afterCaseId ?? undefined,
      });
    } catch { /* A missing/denied projection must not appear as zero workload. */ }
  }
  const selected = workspace?.curators.find((curator) => curator.id === curatorId);
  return (
    <details id="curator-coverage" className="rounded-card border border-border bg-surface" open={requested.some((value) => value !== undefined)} data-testid="v3-curator-coverage">
      <summary className="min-h-11 cursor-pointer px-5 py-4 font-semibold text-fg">Нагрузка и замещение кураторов</summary>
      <div className="space-y-5 border-t border-border p-5">
        <p className="text-sm text-fg-2">Активные дела, открытые задачи и ближайший срок. Выберите куратора, затем студента для проверки переноса.</p>
        {invalid ? <p role="alert" className="text-sm text-fg-2">Параметры выбора не приняты. <Link href="/v3/profile#curator-coverage" className="underline">Начать выбор заново</Link>.</p>
          : !workspace ? <p role="alert" className="text-sm text-fg-2">Нагрузка сейчас недоступна. Это не означает, что дел или задач нет. <Link href={curatorId ? href(curatorId, caseId ?? undefined, afterCaseId ?? undefined) : "/v3/profile#curator-coverage"} className="underline">Повторить чтение</Link>.</p>
            : <>
              {workspace.curators.length === 0 ? <p className="text-sm text-fg-2">Кураторов пока нет.</p> : <ul className="divide-y divide-border">
                {workspace.curators.map((curator) => <li key={curator.id} className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <Link href={href(curator.id)} aria-current={curator.id === curatorId ? "page" : undefined} className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-fg hover:underline">{curator.name}</Link>
                    {!curator.active ? <p className="text-sm text-fg-2">Недоступен для нового назначения</p> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div><dt className="text-fg-2">Активных дел</dt><dd className="font-medium text-fg">{curator.active_case_count}</dd></div>
                    <div><dt className="text-fg-2">Открытых задач</dt><dd className="font-medium text-fg">{curator.open_task_count}</dd></div>
                    <div className="col-span-2"><dt className="inline text-fg-2">Ближайший срок: </dt><dd className="inline text-fg">{coverageDeadlineLabel(curator.nearest_due)}</dd></div>
                  </dl>
                </li>)}
              </ul>}
              {selected ? <div className="space-y-3 border-t border-border pt-4">
                <h3 className="font-semibold text-fg">Студенты: {selected.name}</h3>
                {workspace.cases.length === 0 ? <p className="text-sm text-fg-2">На этой странице активных дел нет.</p> : <form action="/v3/profile#curator-coverage" method="get" className="flex flex-wrap items-end gap-3">
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
                <div className="flex flex-wrap gap-3">
                  {afterCaseId ? <Link href={href(selected.id)} className={`${btnGhostCls} min-h-11`}>К началу списка</Link> : null}
                  {workspace.next_case_id ? <Link href={href(selected.id, undefined, workspace.next_case_id)} className={`${btnGhostCls} min-h-11`}>Следующие студенты</Link> : null}
                </div>
              </div> : null}
            </>}
        {workspace?.preview && workspace.preview.owner_id !== curatorId ? <div role="alert" className="space-y-2 border-s-2 border-border ps-3 text-sm text-fg-2">
          <p>Текущий куратор: {workspace.curators.find((curator) => curator.id === workspace.preview!.owner_id)?.name}. Старый выбор больше не подходит для переноса.</p>
          <Link href={href(workspace.preview.owner_id, workspace.preview.id)} className={`${btnGhostCls} min-h-11`}>Открыть актуальное назначение</Link>
        </div> : null}
        {caseId ? <CuratorCoverageForm key={caseId} preview={workspace?.preview ?? null} curators={workspace?.curators ?? []} requestId={randomUUID()} /> : null}
      </div>
    </details>
  );
}
