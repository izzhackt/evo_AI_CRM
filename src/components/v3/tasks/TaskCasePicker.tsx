"use client";

import { useId, useRef, useState, useTransition } from "react";
import type { PlatformAdmissionsCursor } from "@/lib/platform-admissions";
import { searchTaskCasesAction } from "@/lib/v3/task-case-actions";
import type { CalendarCaseOption } from "../calendar/types";

const CONTROL = "mt-1 min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent/20";
export function TaskCasePicker({ initialCases, initialHasMore, selectedCase }: Readonly<{
  initialCases: readonly CalendarCaseOption[]; initialHasMore: boolean; selectedCase?: CalendarCaseOption;
}>) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState(initialCases);
  const [selected, setSelected] = useState(selectedCase?.id ?? initialCases[0]?.id ?? "");
  const [cursor, setCursor] = useState<PlatformAdmissionsCursor | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [status, setStatus] = useState("idle");
  const [pending, startTransition] = useTransition();
  const sequence = useRef(0);
  function search(more = false) {
    const current = ++sequence.current;
    startTransition(async () => {
      try {
        const result = await searchTaskCasesAction(query, more ? cursor : null);
        if (sequence.current !== current) return;
        setStatus(result.status);
        if (result.status !== "ready") return;
        const next = more && cursor ? [...rows, ...result.rows] : result.rows;
        setRows(next);
        setCursor(result.nextCursor);
        setHasMore(result.nextCursor !== null);
        if (!next.some((row) => row.id === selected)) setSelected(next[0]?.id ?? "");
      } catch { if (sequence.current === current) setStatus("unavailable"); }
    });
  }
  if (selectedCase) return <div className="text-sm"><span className="text-fg-2">Студент: </span>{selectedCase.name}<input type="hidden" name="student_case_id" value={selectedCase.id} /></div>;
  return <div className="space-y-2 md:col-span-2 xl:col-span-3">
    <label htmlFor={`${id}-search`} className="text-sm font-medium text-fg-2">Найти активное дело студента</label>
    <div className="flex flex-wrap gap-2">
      <input id={`${id}-search`} value={query} maxLength={200} onChange={(event) => {
        // A response belongs to the exact query that started it, including its cursor.
        sequence.current += 1;
        setQuery(event.target.value);
        setCursor(null);
        setHasMore(false);
        setStatus("idle");
      }}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); search(); } }}
        className={`${CONTROL} min-w-0 flex-1`} placeholder="Имя студента" />
      <button type="button" disabled={pending} onClick={() => search()} className="min-h-11 rounded-ctl border border-control-edge px-3 text-sm">{pending ? "Ищем…" : "Найти"}</button>
    </div>
    <label htmlFor={`${id}-case`} className="text-sm font-medium text-fg-2">Студент</label>
    <select id={`${id}-case`} name="student_case_id" required value={selected} onChange={(event) => setSelected(event.target.value)} className={CONTROL}>
      <option value="" disabled>Выберите дело</option>
      {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
    {hasMore ? <button type="button" disabled={pending} onClick={() => search(true)} className="min-h-11 text-sm text-accent-text underline">{cursor ? "Показать ещё" : "Открыть поиск с постраничной выборкой"}</button> : null}
    {status === "ready" && rows.length === 0 ? <p role="status" className="text-sm text-fg-2">Активных дел по этому запросу нет.</p> : null}
    {["unavailable", "forbidden", "invalid"].includes(status) ? <p role="alert" className="text-sm text-danger">Не удалось получить доступные дела. Повторите поиск или обновите страницу.</p> : null}
  </div>;
}
