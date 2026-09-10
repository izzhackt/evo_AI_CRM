"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { publishReviewedUniversityAction } from "@/lib/platform-university-batch-actions";
import type { UniversityActionState } from "@/lib/platform-university-catalog";
import type { UniversityBatchRow } from "@/lib/server/university-catalog-batch";

const button = "inline-flex min-h-11 items-center justify-center rounded-ctl border border-border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const labels = { new: "Новая карточка", update: "Обновление", current: "Уже актуальна", identity_conflict: "Нужно сверить название или город" };
const errors: Partial<Record<UniversityActionState["status"], string>> = {
  unavailable: "Нет подтверждения от сервера. Повтор использует тот же запрос и не создаст дубликат.",
  stale: "Карточка или подготовленные сведения изменились. Обновите страницу и проверьте новую версию.",
  forbidden: "Нужен действующий Admin-доступ. Проверьте вход и выбранную роль.",
  invalid: "Сервер отклонил сведения. Публикация остановлена; требуется проверить карточку.",
  request_conflict: "Запрос уже использован с другими параметрами. Публикация остановлена.",
};

export function UniversityBatchReview({ initialRows }: { initialRows: readonly UniversityBatchRow[] }) {
  // Freeze versions/digests while this review is open, including across revalidation.
  const [rows] = useState(initialRows);
  const countries = [...new Set(rows.map((row) => row.country))].sort();
  const [selected, setSelected] = useState(() => new Set(countries));
  const [confirmed, setConfirmed] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState("");
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const stop = useRef(false);
  const busy = useRef(false);
  const candidates = rows.filter((row) => selected.has(row.country) && (row.state === "new" || row.state === "update"));
  const remaining = candidates.filter((row) => !completed.has(row.key));
  const countryName = (code: string) => new Intl.DisplayNames(["ru"], { type: "region" }).of(code) ?? code;
  async function run() {
    if (busy.current || !confirmed || remaining.length === 0) return;
    busy.current = true; stop.current = false; setRunning(true); setFailure(null);
    try {
      for (const row of remaining) {
        if (stop.current) break;
        setActive(row.name);
        let status: UniversityActionState["status"];
        try { status = await publishReviewedUniversityAction({ key: row.key, hash: row.hash, institutionId: row.institutionId, baseVersion: row.baseVersion, confirmed: true }); }
        catch { status = "unavailable"; }
        if (status !== "published") { setFailure({ key: row.key, message: errors[status] ?? "Публикация не подтверждена." }); break; }
        setCompleted((previous) => new Set([...previous, row.key]));
      }
    } finally { busy.current = false; setRunning(false); setActive(""); }
  }
  return <div className="space-y-6">
    <p className="max-w-3xl text-sm leading-6 text-fg-2">Проверьте подготовленные карточки по ссылкам ниже. Выберите страны и подтвердите публикацию. Сначала для каждой карточки сохраняется черновик, затем новая опубликованная версия. Существующие сведения не удаляются.</p>
    <p className="text-sm text-fg-2">Подготовлено: {rows.length}. Уже актуальны: {rows.filter((row) => row.state === "current").length}. Требуют сверки: {rows.filter((row) => row.state === "identity_conflict").length}.</p>
    <fieldset disabled={running} className="space-y-3">
      <legend className="mb-3 font-semibold text-fg">Страны и карточки для проверки</legend>
      {countries.map((country) => <div key={country} className="rounded-card border border-border bg-surface p-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium text-fg"><input type="checkbox" checked={selected.has(country)} onChange={(event) => { setSelected((old) => { const next = new Set(old); if (event.target.checked) next.add(country); else next.delete(country); return next; }); setConfirmed(false); }} className="h-5 w-5 accent-accent" />{countryName(country)} · {rows.filter((row) => row.country === country).length}</label>
        <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-accent-text">Посмотреть карточки</summary>
          <ul className="divide-y divide-border">{rows.filter((row) => row.country === country).map((row) => <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div><p className="font-medium text-fg">{row.name}</p><p className="mt-1 text-xs text-fg-3">{completed.has(row.key) ? "Опубликована" : labels[row.state]} · программ: {row.programs}{row.baseVersion ? ` · текущая версия ${row.baseVersion}` : ""}</p></div>
            <Link href={`/v3/universities/manage?template=${row.key}`} target="_blank" className={button}>Просмотреть<span className="sr-only"> {row.name} (в новой вкладке)</span></Link>
          </li>)}</ul>
        </details>
      </div>)}
    </fieldset>
    <div className="rounded-card border border-border bg-surface p-5">
      <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-fg"><input type="checkbox" disabled={running} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-accent" />Я проверил сведения выбранных стран и подтверждаю их публикацию для сотрудников и студентов.</label>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => void run()} disabled={running || !confirmed || remaining.length === 0} className={`${button} bg-accent text-on-accent`}>{failure ? "Повторить с места остановки" : "Опубликовать выбранные"} ({remaining.length})</button>
        {running ? <button type="button" onClick={() => { stop.current = true; }} className={button}>Остановить после текущей</button> : <Link href="/v3/universities" className={button}>Открыть каталог</Link>}
      </div>
      <p role="status" aria-live="polite" className="mt-4 text-sm text-fg-2">{running ? `Публикуется: ${active}. Подтверждено: ${completed.size}.` : `В этом запуске опубликовано: ${completed.size}. Осталось в выбранных странах: ${remaining.length}.`}</p>
      {failure ? <p role="alert" className="mt-3 text-sm leading-6 text-danger">{rows.find((row) => row.key === failure.key)?.name}: {failure.message}</p> : null}
      <p className="mt-3 text-xs leading-5 text-fg-3">Не закрывайте вкладку во время публикации. После обрыва откройте этот экран снова: совпадающие опубликованные версии будут пропущены, незавершённый запрос можно безопасно повторить.</p>
    </div>
  </div>;
}
