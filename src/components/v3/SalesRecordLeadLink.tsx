"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { inputCls } from "@/components/ui";
import { linkSalesRecordLeadAction, searchSalesRecordLeadOptionsAction } from "@/lib/platform-sales-register-actions";
import type { SalesRecordLeadLink, SalesRecordLeadLinkActionState, SalesRecordLeadOption } from "@/lib/sales-record-lead-contract";
import { salesStage } from "@/lib/v3/wording";
import { useAnchoredPopover } from "./queue/useAnchoredPopover";
import { MENU_ITEM } from "./closure/Closure";

/**
 * «Связать с лидом» (Э8.7, 28.09.2026, владелец: «можно связать, но это не
 * рабочее место, просто связать»). Строка «Лид» панели записи «Отчёта
 * продаж»: связана — имя лида ссылкой на карточку и «Отвязать от лида» в
 * «⋯» панели (`SalesRecordLeadMenu`); связана, но актёр не читает лид — слова
 * без прочерка наугад; не связана и актёр может изменять запись — спокойная
 * «Связать с лидом», открывающая маленький поиск (комбобокс над
 * `sales_record_lead_options_v1`, строки 44 px, доступный с клавиатуры);
 * иначе — ничего.
 */

const MESSAGES: Record<Exclude<SalesRecordLeadLinkActionState["status"], "idle" | "saved">, string> = {
  invalid: "Проверьте выбор лида.",
  forbidden: "Нет доступа к этому действию.",
  stale: "Запись изменил другой сотрудник. Обновите данные и повторите.",
  request_conflict: "Этот запрос уже использован. Обновите данные перед повтором.",
  unavailable: "Не удалось сохранить. Проверьте подключение и повторите.",
  lead_has_sale: "У этого лида уже есть продажа в отчёте — связать нельзя.",
  lead_already_linked: "Этот лид уже связан с другой записью отчёта.",
};

function leadHref(leadId: string): string {
  return `/v3/profile?id=${encodeURIComponent(leadId)}`;
}

function linkFormData(record: { id: string; version: number }, requestId: string, leadId: string | null): FormData {
  const form = new FormData();
  form.set("record_id", record.id);
  form.set("expected_version", String(record.version));
  form.set("request_id", requestId);
  form.set("lead_id", leadId ?? "");
  return form;
}

const RESULT_ROW = "flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-nav px-3 text-start hover:bg-surface-2";

/** Маленький поиск лида: текстовое поле и список результатов, 44 px строки, доступный с клавиатуры (Tab/Enter, Esc — popover). */
function SalesRecordLeadSearch({ record, requestId, onSaved }: {
  record: { id: string; version: number }; requestId: string; onSaved: () => void;
}) {
  const menu = useAnchoredPopover("start");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<readonly SalesRecordLeadOption[]>([]);
  const [status, setStatus] = useState<"idle" | "pending" | "ready" | "invalid" | "unavailable">("idle");
  const [searchPending, startSearch] = useTransition();
  const generation = useRef(0);
  const [state, dispatch, linking] = useActionState<SalesRecordLeadLinkActionState, FormData>(linkSalesRecordLeadAction, {
    status: "idle", requestId, recordId: record.id,
  });
  useEffect(() => {
    if (state.status === "saved") { document.getElementById(menu.popoverId)?.hidePopover(); onSaved(); }
  }, [state.status, menu.popoverId, onSaved]);
  function search(value: string) {
    setQuery(value);
    const trimmed = value.trim();
    if (trimmed.length < 2) { setOptions([]); setStatus("idle"); return; }
    const gen = ++generation.current;
    setStatus("pending");
    startSearch(async () => {
      const result = await searchSalesRecordLeadOptionsAction(trimmed).catch(() => ({ status: "unavailable" as const, options: [] }));
      if (gen !== generation.current) return;
      setOptions(result.options);
      setStatus(result.status);
    });
  }
  function choose(option: SalesRecordLeadOption) {
    dispatch(linkFormData(record, state.requestId, option.id));
  }
  return <>
    <button id={menu.triggerId} type="button" popoverTarget={menu.popoverId} style={menu.triggerStyle}
      className="inline-flex min-h-11 items-center text-fg-2 underline underline-offset-4 hover:text-fg" data-testid="sales-record-link-lead-open">
      Связать с лидом
    </button>
    <div id={menu.popoverId} popover="auto" style={menu.popoverStyle} role="dialog" aria-label="Связать запись с лидом"
      className="v3-anchored w-80 max-w-[calc(100vw-1rem)] space-y-2 rounded-ctl border border-border bg-surface p-3 text-fg shadow-evo-lg"
      data-testid="sales-record-link-lead-search">
      <label className="block"><span className="sr-only">Имя лида</span>
        <input autoFocus value={query} onChange={(event) => search(event.target.value)} placeholder="Имя лида, от 2 букв"
          disabled={linking} className={`${inputCls} min-h-11 w-full`} />
      </label>
      {status === "pending" || searchPending ? <p role="status" className="t-meta text-fg-2">Ищем…</p> : null}
      {status === "ready" && options.length === 0 ? <p role="status" className="t-meta text-fg-2">Ничего не найдено.</p> : null}
      {status === "unavailable" ? <p role="alert" className="t-meta text-fg-2">Поиск недоступен. Попробуйте ещё раз.</p> : null}
      {status === "ready" && options.length > 0 ? <ul className="max-h-64 space-y-0.5 overflow-y-auto">
        {options.map((option) => <li key={option.id}>
          <button type="button" disabled={linking} className={RESULT_ROW} onClick={() => choose(option)} data-testid="sales-record-link-lead-option">
            <span className="t-body-compact text-fg">{option.name}</span>
            <span className="t-meta text-fg-2">{salesStage(option.stage) ?? "Этап неизвестен"}</span>
          </button>
        </li>)}
      </ul> : null}
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className="t-meta text-fg-2">{MESSAGES[state.status]}</p> : null}
    </div>
  </>;
}

export function SalesRecordLeadFact({ link, canManage, record, requestId }: {
  link: SalesRecordLeadLink; canManage: boolean; record: { id: string; version: number }; requestId: string;
}) {
  const router = useRouter();
  if (link === null) return canManage ? <SalesRecordLeadSearch record={record} requestId={requestId} onSaved={() => router.refresh()} /> : null;
  if (!link.visible) return <span className="text-fg-2">связано, но недоступно</span>;
  return <Link href={leadHref(link.leadId)} className="text-fg underline underline-offset-4 hover:no-underline" data-testid="sales-record-linked-lead">
    {link.name}
  </Link>;
}

/** «⋯» панели записи (Э8.7): пока — только «Отвязать от лида», когда запись связана и её можно изменять. */
export function SalesRecordLeadMenu({ record, leadName, requestId }: {
  record: { id: string; version: number }; leadName: string; requestId: string;
}) {
  const router = useRouter();
  const menu = useAnchoredPopover("end");
  const [state, dispatch, pending] = useActionState<SalesRecordLeadLinkActionState, FormData>(linkSalesRecordLeadAction, {
    status: "idle", requestId, recordId: record.id,
  });
  useEffect(() => {
    if (state.status === "saved") { document.getElementById(menu.popoverId)?.hidePopover(); router.refresh(); }
  }, [state.status, menu.popoverId, router]);
  return <>
    <button id={menu.triggerId} type="button" popoverTarget={menu.popoverId} style={menu.triggerStyle}
      aria-label={`Ещё по записи: связана с лидом ${leadName}`}
      className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
      <Icon name="more-horizontal" size={20} />
    </button>
    <div id={menu.popoverId} popover="auto" style={menu.popoverStyle} role="group" aria-label="Действия записи"
      className="v3-anchored v3-anchored-end w-56 rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg">
      <button type="button" className={MENU_ITEM} disabled={pending}
        onClick={() => dispatch(linkFormData(record, state.requestId, null))} data-testid="sales-record-unlink-lead">
        {pending ? "Отвязываем…" : "Отвязать от лида"}
      </button>
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className="px-3 py-1 t-meta text-fg-2">{MESSAGES[state.status]}</p> : null}
    </div>
  </>;
}
