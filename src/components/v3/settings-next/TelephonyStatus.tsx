"use client";

import { ListIcon } from "lucide-react";

import { DetailSheet, StatusBadge, WidgetCard, type StatusTone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { TelephonyStatusLine, TelephonyTone } from "@/lib/v3/telephony-health";

const TONE: Readonly<Record<TelephonyTone, StatusTone>> = { ok: "ok", warn: "warn", blocked: "danger", off: "neutral" };

function Line({ line }: Readonly<{ line: TelephonyStatusLine }>) {
  const attention = line.tone === "warn" || line.tone === "blocked";
  return (
    <li data-line={line.id} data-tone={line.tone} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <span className="t-body-compact text-fg-2">{line.label}</span>
      <span className="min-w-0">
        <StatusBadge tone={TONE[line.tone]} label={line.value} wrap />
        {line.note ? <span className="mt-0.5 block t-meta text-fg-2">{line.note}</span> : null}
        {/* Что не работает из-за строки и кто это чинит — рядом с ней, а не в другом месте страницы. */}
        {attention && line.without ? <span className="block t-meta text-fg-2" data-testid="v3-telephony-without">{line.without}.</span> : null}
        {attention && line.id === "directory" ? <a href="#tel-extensions-title" className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4 hover:text-fg-2">Сопоставить</a> : null}
        {attention && line.handoff ? <span className={`block t-meta font-medium ${line.tone === "blocked" ? "text-danger" : "text-fg"}`} data-testid="v3-telephony-handoff">{line.handoff}</span> : null}
      </span>
    </li>
  );
}

/**
 * «Состояние» телефонии: сверху одно предложение — сколько строк требуют внимания; сами эти строки идут первыми, каждая с тем, что из-за
 * неё не работает, и кому это передать. Остальные (в порядке и выключено) — в панели: двенадцать равных строк заставляли читать всё,
 * чтобы найти одну красную.
 */
export function TelephonyStatus({ lines }: Readonly<{ lines: readonly TelephonyStatusLine[] }>) {
  const attention = lines.filter((line) => line.tone === "warn" || line.tone === "blocked");
  const rest = lines.filter((line) => line.tone === "ok" || line.tone === "off");
  return (
    <WidgetCard
      title="Состояние"
      headingLevel={3}
      actions={rest.length > 0 ? (
        <DetailSheet title="Все строки состояния" trigger={<Button variant="outline"><ListIcon aria-hidden="true" />{attention.length > 0 ? `Остальные строки: ${rest.length}` : `Показать все ${lines.length}`}</Button>}>
          <ul className="divide-y divide-border" data-testid="v3-telephony-status-rest">{rest.map((line) => <Line key={line.id} line={line} />)}</ul>
        </DetailSheet>
      ) : undefined}
    >
      <div data-testid="v3-telephony-status">
        <p className="t-body-compact text-fg" data-testid="v3-telephony-verdict">
          {attention.length > 0 ? `Требует внимания: ${attention.length} из ${lines.length}` : "Замечаний нет"}
        </p>
        {attention.length > 0 ? <ul className="divide-y divide-border">{attention.map((line) => <Line key={line.id} line={line} />)}</ul> : null}
      </div>
    </WidgetCard>
  );
}
