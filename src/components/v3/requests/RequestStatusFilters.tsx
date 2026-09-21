"use client";

import { useEffect, useRef } from "react";
import { requestKindSelected, type RequestSelection } from "@/lib/requests-queue-contract";

const selectClass = "min-h-11 w-full rounded-nav border border-control-edge bg-surface px-3 text-sm text-fg";

export function RequestStatusFilters({ selection }: { selection: RequestSelection }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // Native GET submissions can restore the previous document from bfcache
    // with its unsent field values. The URL's server selection remains truth.
    const reset = () => form.current?.reset();
    reset();
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, [selection]);

  return <form ref={form} action="/v3/requests" autoComplete="off" className="flex flex-wrap items-end gap-3">
    <input type="hidden" name="source" value={selection.source} />
    {selection.limit !== 50 ? <input type="hidden" name="limit" value={selection.limit} /> : null}
    {requestKindSelected("application", selection.source) ? <label className="grid min-w-0 w-full gap-1 text-sm text-fg-2 sm:flex-1 sm:max-w-64">
      Анкеты платформы
      <select className={selectClass} name="applications" defaultValue={selection.applicationStatus}>
        <option value="pending">Ожидают решения</option><option value="all">Все статусы</option>
      </select>
    </label> : <input type="hidden" name="applications" value={selection.applicationStatus} />}
    {requestKindSelected("consultation", selection.source) ? <label className="grid min-w-0 w-full gap-1 text-sm text-fg-2 sm:flex-1 sm:max-w-64">
      Консультации
      <select className={selectClass} name="consultations" defaultValue={selection.consultationStatus}>
        <option value="all">Все статусы</option><option value="requested">Открытые</option><option value="handled">Обработанные</option>
      </select>
    </label> : <input type="hidden" name="consultations" value={selection.consultationStatus} />}
    <button type="submit" className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-3 text-sm font-medium text-fg hover:bg-surface-2">Применить</button>
  </form>;
}
