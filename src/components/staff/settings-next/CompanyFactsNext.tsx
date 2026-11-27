"use client";

import { PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { DataTable, DetailSheet, EmptyState, WidgetCard } from "@/components/kit";
import { GuardedBody, useSheetGuard } from "@/components/staff/admin-next/SheetGuard";
import { sheetEscape } from "@/components/staff/panel/sheet-escape";
import { CompanyFactForm, CompanyFactRetire } from "@/components/staff/settings/CompanyFactForm";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { companyFactDateLabel, type CompanyFact, type CompanyFactsRead } from "@/lib/ai-agents/company-facts";
import { companyFactTopicTitle, companyFactWords } from "@/lib/v3/wording";
import { buildColumns, unavailableLine } from "./company-fact-columns";

type Filter = "all" | "expired" | "expiring";

/**
 * «Факты» («мозг компании», миграция 381): таблица проверенных фактов со сроком годности. Тема словами и ключом мелко, текст, кому,
 * источник, «Проверено …», «Годен до …»; просроченные и истекающие в 30 дней помечены и сверху одной строкой. «Проверено» и «Изменить»
 * в строке, «Добавить факт» и «Снять» в панели. Агенты видят только действующие непросроченные факты. В режиме только чтения кнопок
 * записи нет. Несохранённую правку панель не выбрасывает молча (`useSheetGuard`).
 */
export function CompanyFactsNext({ read, readOnly }: Readonly<{ read: CompanyFactsRead; readOnly: boolean }>) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showRetired, setShowRetired] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [locked, setLocked] = useState(false);
  const onLockedChange = useCallback((value: boolean) => setLocked(value), []);
  const guard = useSheetGuard();
  const data = read.status === "available" ? read.data : null;
  const canEdit = Boolean(data?.canManage) && !readOnly;
  const onEdit = useCallback((fact: CompanyFact) => setOpenId(fact.id), []);
  const columns = useMemo(() => buildColumns(canEdit, onEdit), [canEdit, onEdit]);
  const visible = useMemo(() => (data?.facts ?? []).filter((fact) => {
    if (fact.status === "retired" ? !showRetired : fact.status !== "active") return false;
    if (filter === "expired") return fact.validity === "expired";
    if (filter === "expiring") return fact.validity === "expiring";
    return true;
  }), [data, filter, showRetired]);

  if (read.status !== "available" || !data) {
    return (
      <WidgetCard headingLevel={3} title={companyFactWords.title} bodyClassName="grid gap-3">
        <p role="alert" className="t-body-compact text-fg">{unavailableLine(read.status === "available" ? "unavailable" : read.status)}</p>
        {read.status === "unavailable" ? <div><Button variant="outline" asChild><a href="/settings?section=facts">Обновить</a></Button></div> : null}
      </WidgetCard>
    );
  }
  const open = data.facts.find((fact) => fact.id === openId) ?? null;
  const retiredCount = data.facts.filter((fact) => fact.status === "retired").length;
  const chips: readonly Readonly<{ key: Filter; label: string; count: number | null }>[] = [
    { key: "all", label: companyFactWords.filterAll, count: data.counts.active },
    { key: "expired", label: companyFactWords.filterExpired, count: data.counts.expired },
    { key: "expiring", label: companyFactWords.filterExpiring, count: data.counts.expiring },
  ];
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-company-facts">
      <p className="max-w-prose t-body-compact text-fg-2">{companyFactWords.intro}</p>
      {data.counts.expired > 0 ? <p role="status" className="rounded-ctl border border-danger bg-danger-weak px-3 py-2 t-body-compact text-danger" data-testid="v3-company-facts-expired">{companyFactWords.expiredBanner(data.counts.expired)}</p> : null}
      {data.counts.expiring > 0 ? <p role="status" className="rounded-ctl border border-border bg-surface-2 px-3 py-2 t-body-compact text-fg" data-testid="v3-company-facts-expiring">{companyFactWords.expiringBanner(data.counts.expiring)}</p> : null}
      {data.truncated ? <p role="status" className="t-meta text-fg-3">{companyFactWords.truncated}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Фильтр по сроку" className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Button key={chip.key} variant={filter === chip.key ? "default" : "outline"} aria-pressed={filter === chip.key} onClick={() => setFilter(chip.key)}>
              {chip.label}{chip.count !== null ? ` · ${chip.count}` : ""}
            </Button>
          ))}
        </div>
        {canEdit ? <Button onClick={() => setCreating(true)}><PlusIcon aria-hidden="true" />{companyFactWords.add}</Button> : null}
      </div>
      {!data.canManage ? <p className="t-meta text-fg-3">{companyFactWords.readOnly}</p> : null}
      <DataTable
        label={companyFactWords.list}
        data={visible}
        columns={columns}
        getRowId={(fact) => fact.id}
        getRowLabel={(fact) => companyFactTopicTitle(fact.topic)}
        onRowClick={canEdit ? (fact) => { if (fact.status === "active") setOpenId(fact.id); } : undefined}
        searchPlaceholder={companyFactWords.search}
        columnMenu={false}
        pageSize={25}
        toolbar={retiredCount ? (
          <label className="flex min-h-11 items-center gap-2 t-label text-fg-2">
            <Checkbox checked={showRetired} onCheckedChange={(value) => setShowRetired(value === true)} />{companyFactWords.showRetired} · {retiredCount}
          </label>
        ) : undefined}
        empty={<EmptyState title={filter === "all" ? companyFactWords.empty : companyFactWords.allFine} />}
      />
      <DetailSheet
        onEscapeKeyDown={sheetEscape}
        open={open !== null}
        onOpenChange={(next) => { if (!next && guard.allowClose(locked)) setOpenId(null); }}
        title={open ? companyFactTopicTitle(open.topic) : companyFactWords.edit}
        description={open ? `Проверено ${companyFactDateLabel(open.verifiedAt)}` : undefined}
      >
        <GuardedBody guard={guard}>
          {open ? (
            <div className="grid gap-6">
              <CompanyFactForm key={open.id} fact={open} onDone={() => setOpenId(null)} onLockedChange={onLockedChange} />
              <CompanyFactRetire key={`retire-${open.id}`} fact={open} onDone={() => setOpenId(null)} onLockedChange={onLockedChange} />
            </div>
          ) : null}
        </GuardedBody>
      </DetailSheet>
      <DetailSheet
        onEscapeKeyDown={sheetEscape}
        open={creating}
        onOpenChange={(next) => { if (!next && guard.allowClose(locked)) setCreating(false); }}
        title={companyFactWords.add}
      >
        <GuardedBody guard={guard}>
          {creating ? <CompanyFactForm fact={null} onDone={() => setCreating(false)} onLockedChange={onLockedChange} /> : null}
        </GuardedBody>
      </DetailSheet>
    </div>
  );
}
