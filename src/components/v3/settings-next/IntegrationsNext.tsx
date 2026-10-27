"use client";

import { AlertTriangleIcon, CircleCheckIcon, CircleIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataTable, DetailSheet, KeyFacts, StatusBadge, type DataTableColumn, type StatusTone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { IntegrationRow } from "@/components/v3/settings/types";
import { WhatsAppConnectSection } from "@/components/v3/settings/WhatsAppConnectSection";
import { WHATSAPP_CONNECT_ANCHOR } from "@/lib/v3/whatsapp-connect-contract";

import { TransportCardNext } from "./TransportCardNext";
import type { SettingsWhatsApp } from "./settings-next-types";

const TONE: Readonly<Record<IntegrationRow["tone"], StatusTone>> = { ok: "ok", warn: "warn", blocked: "danger", off: "neutral" };
const ICON = { ok: CircleCheckIcon, warn: AlertTriangleIcon, blocked: AlertTriangleIcon, off: CircleIcon } as const;

/** Ссылка «Что сделать» на блок подключения ниже — не второй путь туда же, когда карточка подключения стоит на странице. */
const actionOf = (row: IntegrationRow, connectCard: boolean) => {
  if (!row.action) return null;
  const link = connectCard && row.action.link?.href.endsWith(`#${WHATSAPP_CONNECT_ANCHOR}`) ? null : row.action.link;
  return row.action.handoff || link ? { handoff: row.action.handoff, link } : null;
};

function columns(): DataTableColumn<IntegrationRow>[] {
  return [
    {
      id: "name", accessorFn: (row) => row.name, header: "Сервис", meta: { mobile: "title" }, enableHiding: false,
      cell: ({ row }) => <span data-integration={row.original.key} data-tone={row.original.tone} className="font-medium text-fg">{row.original.name}</span>,
    },
    {
      id: "state", accessorFn: (row) => row.state, header: "Состояние",
      cell: ({ row }) => {
        const Icon = ICON[row.original.tone];
        return (
          <span className="block min-w-0">
            <span className="inline-flex items-center gap-1.5"><Icon aria-hidden="true" className="size-4 shrink-0 text-fg-3" /><StatusBadge tone={TONE[row.original.tone]} label={row.original.state} wrap /></span>
            {row.original.detail ? <span className="mt-0.5 block t-meta text-fg-2">{row.original.detail}</span> : null}
          </span>
        );
      },
    },
    {
      id: "checked", accessorFn: (row) => row.checkedAt ?? "", header: "Последняя проверка",
      cell: ({ row }) => row.original.checkedAt && row.original.checkedText
        ? <time dateTime={row.original.checkedAt} className="tabular-nums">{row.original.checkedText}</time>
        : row.original.checkable ? <span className="text-fg-3">нет данных</span> : <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">проверки нет</span></>,
    },
    {
      id: "without", accessorFn: (row) => row.without ?? "", header: "Что не работает",
      cell: ({ row }) => row.original.without ?? <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">всё работает</span></>,
    },
  ];
}

function SheetBody({ row, connectCard }: Readonly<{ row: IntegrationRow; connectCard: boolean }>) {
  const action = actionOf(row, connectCard);
  return (
    <div className="grid gap-5">
      <KeyFacts columns={1} facts={[
        { label: "Состояние", value: row.detail ? `${row.state}. ${row.detail}` : row.state },
        { label: "Последняя проверка", value: row.checkedText ?? (row.checkable ? "нет данных" : "проверки нет") },
        { label: "Что не работает", value: row.without ?? "Всё работает" },
        { label: "Что сделать", value: action ? action.handoff : row.action ? "Подключение — в карточке ниже." : "Ничего" },
      ]} />
      {action?.link ? <div><Button variant="outline" asChild><Link href={action.link.href}>{action.link.label}</Link></Button></div> : null}
    </div>
  );
}

/**
 * «Интеграции»: одна строка на сервис (состояние словом со значком, причина, последняя проверка, что не работает без сервиса),
 * строка открывает панель с тем, что сделать (работа на сервере и кто её делает, ссылка на страницу CRM по сервису). Состояния
 * только для чтения: флаги живут в файлах окружения сервера, из браузера их не меняют. Под таблицей — канал WhatsApp: карточка
 * Wazzup (только чтение) или, пока Wazzup не включён, прежнее «Подключение WhatsApp» с QR. «Что не работает» — колонка таблицы на любой
 * ширине, а не колонка второго плана: рядом с меню разделов таблица уже 64rem на любом экране, и такая колонка не показывалась бы нигде,
 * кроме телефона (последствие сломанного сервиса — предупреждение, оно на виду).
 */
export function IntegrationsNext({ rows, whatsapp, nowIso }: Readonly<{ rows: readonly IntegrationRow[]; whatsapp?: SettingsWhatsApp; nowIso: string }>) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = rows.find((row) => row.key === openKey) ?? null;
  const connectCard = Boolean(whatsapp);
  return (
    <div className="grid min-w-0 gap-4">
      <div data-testid="v3-settings-integrations" className="grid min-w-0">
        <DataTable
          label="Интеграции"
          data={rows}
          columns={columns()}
          getRowId={(row) => row.key}
          getRowLabel={(row) => row.name}
          onRowClick={(row) => setOpenKey(row.key)}
          searchPlaceholder="Найти сервис"
          columnMenu={false}
          paginate={false}
        />
      </div>
      <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next) setOpenKey(null); }} title={open?.name ?? "Сервис"}>
        {open ? <SheetBody row={open} connectCard={connectCard} /> : null}
      </DetailSheet>
      {whatsapp ? (
        whatsapp.wazzup
          ? <TransportCardNext transport={whatsapp.wazzup.transport} intakeEnabled={whatsapp.wazzup.intakeEnabled} nowIso={nowIso} />
          : <WhatsAppConnectSection initialStatus={whatsapp.status} canConnect={whatsapp.canConnect} />
      ) : null}
    </div>
  );
}
