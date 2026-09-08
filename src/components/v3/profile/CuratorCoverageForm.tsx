"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { manageCaseCoverageAction, type CaseCoverageActionState } from "@/lib/platform-case-coverage-actions";
import { coverageDeadlineLabel, type CoverageCurator, type CoveragePreview } from "@/lib/platform-case-coverage-contract";
import { coverageConflictLabel } from "@/lib/v3/wording";

function revision(preview: CoveragePreview): string {
  return JSON.stringify([preview.owner_id, preview.scope_version, preview.coverage?.id,
    preview.coverage?.version, preview.conflicts, preview.tasks.map((task) => [task.id, task.version, task.conflict])]);
}
const RESULTS: Record<Exclude<CaseCoverageActionState["status"], "idle">, string> = {
  saved: "Смена куратора и перенос выбранных задач подтверждены.",
  invalid: "Проверьте заместителя, срок, причину и выбранные задачи.",
  forbidden: "Действие недоступно. Проверьте права и доступность кураторов.",
  stale: "Данные изменились. Ввод сохранён: обновите список и проверьте перенос ещё раз.",
  request_conflict: "Этот запрос уже использован. Проверьте данные и повторите действие.",
  unavailable: "Не удалось подтвердить сохранение. Проверьте актуальные данные перед повтором.",
};

export function CuratorCoverageForm({ preview, curators, requestId }: Readonly<{
  preview: CoveragePreview | null; curators: readonly CoverageCurator[]; requestId: string;
}>) {
  // A failed refresh must not unmount a user's draft. Cached data stays visibly
  // unavailable and cannot authorize a mutation; never use it as a live fallback.
  const [lastRead, setLastRead] = useState(preview ? { preview, curators } : null);
  if (preview && preview !== lastRead?.preview) setLastRead({ preview, curators });
  if (!lastRead) return null;
  return <CoverageDraft preview={lastRead.preview} curators={lastRead.curators} requestId={requestId} readUnavailable={preview === null} />;
}

function CoverageDraft({ preview, curators, requestId, readUnavailable }: Readonly<{
  preview: CoveragePreview; curators: readonly CoverageCurator[]; requestId: string; readUnavailable: boolean;
}>) {
  const router = useRouter();
  // Stable case identity, not scope/task versions: refresh never discards the draft.
  const [reviewed, setReviewed] = useState(preview);
  const [reason, setReason] = useState("");
  const [endOn, setEndOn] = useState("");
  const [substitute, setSubstitute] = useState("");
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const currentRevision = revision(reviewed);
  const [state, action, pending] = useActionState<CaseCoverageActionState & { reviewedRevision: string }, FormData>(async (
    previous: CaseCoverageActionState & { reviewedRevision: string }, form: FormData,
  ) => ({ ...await manageCaseCoverageAction(previous, form), reviewedRevision: currentRevision }), {
    status: "idle", requestId, reviewedRevision: currentRevision,
  });
  const status = state.reviewedRevision === currentRevision ? state.status : "idle";
  const returning = reviewed.coverage !== null;
  const needsReview = revision(preview) !== currentRevision;
  const destination = returning ? reviewed.coverage!.original_curator_id : substitute;
  const destinationName = curators.find((curator) => curator.id === destination)?.name;
  const hasConflict = reviewed.conflicts.length > 0 || reviewed.tasks.some((task) => task.conflict !== null);
  const availableSubstitutes = curators.filter((curator) => curator.active && curator.id !== reviewed.owner_id);
  const locked = pending || status === "saved";
  const canSubmit = !locked && !readUnavailable && !needsReview && status !== "stale" && !hasConflict
    && reason.trim().length > 0 && (returning || (endOn !== "" && availableSubstitutes.some((curator) => curator.id === substitute)));

  useEffect(() => {
    if (status === "saved") {
      // Update the owner filter before fetching: the old owner no longer owns this case.
      const query = new URLSearchParams({ coverage_curator: destination, coverage_case: reviewed.id });
      router.replace(`/v3/profile?${query.toString()}#curator-coverage`, { scroll: false });
    }
  }, [destination, reviewed.id, router, status]);

  return (
    <form action={action} aria-busy={pending} className="space-y-4 border-t border-border pt-5" data-testid="v3-curator-coverage-form">
      <div>
        <h3 className="font-semibold text-fg">{returning ? "Вернуть дело студента" : "Назначить замещение"}: {reviewed.name}</h3>
        <p className="mt-1 text-sm text-fg-2">
          {returning
            ? `Дело вернётся: ${destinationName ?? "прежний куратор"}. Открытые задачи — указанным ниже исполнителям.`
            : "Заместитель станет единственным куратором этого студента. Возврат подтверждает Admin вручную."}
        </p>
        {reviewed.coverage ? <p className="mt-1 text-sm text-fg-2">Плановый возврат: {coverageDeadlineLabel({ due_on: reviewed.coverage.planned_end_on, due_at: null })}</p> : null}
      </div>
      <input type="hidden" name="operation" value={returning ? "return" : "start"} />
      <input type="hidden" name="student_case_id" value={reviewed.id} />
      <input type="hidden" name="expected_owner" value={reviewed.owner_id} />
      <input type="hidden" name="expected_scope_version" value={reviewed.scope_version} />
      <input type="hidden" name="coverage_id" value={reviewed.coverage?.id ?? ""} />
      <input type="hidden" name="expected_coverage_version" value={reviewed.coverage?.version ?? "0"} />
      <input type="hidden" name="task_snapshot" value={JSON.stringify(reviewed.tasks.map(({ id, version }) => ({ id, version })))} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <fieldset disabled={locked} className="min-w-0 space-y-4">
        {returning ? <>
          <input type="hidden" name="substitute_membership_id" value="" />
          <input type="hidden" name="planned_end_on" value="" />
        </> : <div className="grid gap-4 sm:grid-cols-2">
          <label><span className={labelCls}>Заместитель</span>
            <select name="substitute_membership_id" value={substitute} onChange={(event) => setSubstitute(event.target.value)} required className={`${inputCls} min-h-11`}>
              <option value="">Выберите куратора</option>
              {availableSubstitutes.map((curator) => <option key={curator.id} value={curator.id}>{curator.name}</option>)}
            </select>
            {availableSubstitutes.length === 0 ? <span className="mt-1 block text-sm text-fg-2">Нет доступного заместителя.</span> : null}
          </label>
          <label><span className={labelCls}>Плановая дата возврата</span>
            <input name="planned_end_on" type="date" value={endOn} onChange={(event) => setEndOn(event.target.value)} required className={`${inputCls} min-h-11`} />
          </label>
        </div>}
        <label className="block"><span className={labelCls}>{returning ? "Причина возврата" : "Причина отсутствия и замещения"}</span>
          <textarea name="reason" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={1000} rows={2} className={inputCls} />
        </label>
        <div>
          <h4 className="text-sm font-semibold text-fg">Открытые задачи: {reviewed.tasks.length}</h4>
          <p className="mt-1 text-sm text-fg-2">Завершённые задачи и история не меняются.</p>
          {reviewed.tasks.length === 0 ? <p className="mt-3 text-sm text-fg-2">Открытых задач нет. Изменится только куратор.</p> : <ul className="mt-3 divide-y divide-border">
            {reviewed.tasks.map((task) => {
              const transfer = task.required || (task.can_transfer && (choices[task.id] ?? false));
              const targetName = returning ? task.return_assignee_name : destinationName;
              return <li key={task.id} className="space-y-2 py-3 first:pt-0">
                <p className="break-words text-sm font-medium text-fg">{task.title}</p>
                <p className="text-sm text-fg-2">{task.assignee_name} · {coverageDeadlineLabel(task)}</p>
                {task.required || !task.can_transfer ? <>
                  <input type="hidden" name={`task_${task.id}`} value={transfer ? "true" : "false"} />
                  <p className="text-sm text-fg-2">{transfer ? `Переносится: ${targetName ?? "выбранный заместитель"}` : "Остаётся у текущего исполнителя"}</p>
                </> : <label className="block max-w-md"><span className={labelCls}>Перенос задачи «{task.title}»</span>
                  <select name={`task_${task.id}`} value={transfer ? "true" : "false"} onChange={(event) => setChoices((previous) => ({ ...previous, [task.id]: event.target.value === "true" }))} className={`${inputCls} min-h-11`}>
                    <option value="false">Оставить текущему исполнителю</option>
                    <option value="true">Передать: {targetName ?? "выбранный заместитель"}</option>
                  </select>
                </label>}
                {task.conflict ? <p className="border-s-2 border-border ps-3 text-sm text-fg-2">{coverageConflictLabel(task.conflict)}</p> : null}
              </li>;
            })}
          </ul>}
        </div>
      </fieldset>
      {reviewed.conflicts.map((conflict) => <p key={conflict} role="alert" className="text-sm text-fg-2">{coverageConflictLabel(conflict)}</p>)}
      {readUnavailable ? <p role="alert" className="text-sm text-fg-2">Не удалось перечитать дело. Черновик сохранён, но отправка недоступна. Куратора могли уже изменить; проверьте актуальное назначение.</p> : null}
      {status !== "idle" ? <p role={status === "saved" ? "status" : "alert"} className="text-sm text-fg-2">{RESULTS[status]}</p> : null}
      {needsReview ? <div className="space-y-2 border-s-2 border-border ps-3">
        <p className="text-sm text-fg-2">Есть обновлённые данные. Причина, дата и выбор куратора сохранятся; список переноса нужно проверить заново.</p>
        <button type="button" disabled={pending} className={`${btnGhostCls} min-h-11`} onClick={() => { setReviewed(preview); setChoices({}); }}>Показать актуальный состав переноса</button>
      </div> : null}
      {status === "stale" || status === "unavailable" || readUnavailable ? <button type="button" disabled={pending} className={`${btnGhostCls} min-h-11`} onClick={() => router.refresh()}>Обновить данные без сброса ввода</button> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!canSubmit} className={`${btnCls} min-h-11`}>
          {pending ? "Сохраняем…" : returning ? "Подтвердить возврат" : "Подтвердить замещение"}
        </button>
        {!pending ? <Link className={`${btnGhostCls} min-h-11`} href={`/v3/profile?coverage_curator=${preview.owner_id}#curator-coverage`}>Отмена</Link> : null}
      </div>
    </form>
  );
}
