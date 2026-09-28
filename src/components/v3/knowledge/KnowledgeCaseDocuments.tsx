"use client";
import Link from "next/link";
import { useState } from "react";
import type { PlatformCaseDocumentWorkspace } from "@/lib/platform-private-documents";
import { KnowledgeExport } from "./KnowledgeExport";
import { KB_CHECK, KB_QUIET } from "./knowledge-look";

export function KnowledgeCaseDocuments({ caseId, documents }: { caseId: string; documents: PlatformCaseDocumentWorkspace }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return <div className="space-y-3" data-testid="knowledge-case-documents">
    <div className="flex flex-wrap items-center gap-2">
      <KnowledgeExport canonical={{ documentCaseIds: [caseId] }} label="Выгрузить документы" />
      {selected.size > 0 && <>
        <span className="t-item text-fg">Выбрано: <span className="tabular-nums">{selected.size}</span></span>
        <KnowledgeExport canonical={{ documentVersionIds: [...selected] }} label="Выгрузить выбранные документы" />
        <button type="button" className={KB_QUIET} onClick={() => setSelected(new Set())}>Снять выделение</button>
      </>}
    </div>
    {!documents.slots.length && <p className="t-body-compact text-fg-2">В деле пока нет документов.</p>}
    {documents.slots.map((slot) => <section key={slot.documentSlotId} className="space-y-1">
      <h3 className="t-item">{slot.requirementLabel}</h3>
      <ul className="divide-y divide-border border-y border-border">{slot.versions.map((version) => <li key={version.documentVersionId} className="flex items-center gap-1 t-body-compact">
        <label className={`grid size-11 shrink-0 place-items-center rounded-nav ${version.downloadReady ? "cursor-pointer hover:bg-surface-2" : ""}`}>
          <input type="checkbox" className={KB_CHECK} aria-label={`Выбрать ${version.originalFilename}, версия ${version.versionNumber}`} disabled={!version.downloadReady}
            checked={selected.has(version.documentVersionId)} onChange={(event) => setSelected((old) => {
              const next = new Set(old); if (event.target.checked) next.add(version.documentVersionId); else next.delete(version.documentVersionId); return next;
            })} />
        </label>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
          {version.downloadReady
            ? <a href={`/api/v2/document-versions/${version.documentVersionId}/download`} className="inline-flex min-h-11 items-center text-fg underline underline-offset-4 hover:text-fg-2 [overflow-wrap:anywhere]">{version.originalFilename}</a>
            : <span className="py-3 text-fg [overflow-wrap:anywhere]">{version.originalFilename} · недоступен для скачивания</span>}
          <span className="text-fg-2">· версия {version.versionNumber} · {(version.byteSize / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} КБ</span>
        </span>
      </li>)}</ul>
    </section>)}
    {documents.removedSlots.length > 0 && <p><Link href={`/v3/profile?case=${caseId}&tab=documents`} className={KB_QUIET}>Удалённые пункты и архив документов ({documents.removedSlots.length})</Link></p>}
  </div>;
}
