"use client";
import Link from "next/link";
import { useState } from "react";
import type { PlatformCaseDocumentWorkspace } from "@/lib/platform-private-documents";
import { KnowledgeExport } from "./KnowledgeExport";
import styles from "./KnowledgeLibrary.module.css";

export function KnowledgeCaseDocuments({ caseId, documents }: { caseId: string; documents: PlatformCaseDocumentWorkspace }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return <>
    <div className={styles.actions}>
      <KnowledgeExport canonical={{ documentCaseIds: [caseId] }} label="Выгрузить документы" />
      {selected.size > 0 && <>
        <span>Выбрано: {selected.size}</span>
        <KnowledgeExport canonical={{ documentVersionIds: [...selected] }} label="Выгрузить выбранные документы" />
        <button type="button" onClick={() => setSelected(new Set())}>Снять выделение</button>
      </>}
    </div>
    {!documents.slots.length && <p>В деле пока нет документов.</p>}
    {documents.slots.map((slot) => <section key={slot.documentSlotId}><h3>{slot.requirementLabel}</h3>
      <ul>{slot.versions.map((version) => <li key={version.documentVersionId}>
        <input type="checkbox" aria-label={`Выбрать ${version.originalFilename}, версия ${version.versionNumber}`} disabled={!version.downloadReady}
          checked={selected.has(version.documentVersionId)} onChange={(event) => setSelected((old) => {
            const next = new Set(old); if (event.target.checked) next.add(version.documentVersionId); else next.delete(version.documentVersionId); return next;
          })} />
        {version.downloadReady ? <a href={`/api/v2/document-versions/${version.documentVersionId}/download`}>{version.originalFilename}</a> : <span>{version.originalFilename} · недоступен для скачивания</span>}
        <span> · версия {version.versionNumber} · {(version.byteSize / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} КБ</span>
      </li>)}</ul>
    </section>)}
    {documents.removedSlots.length > 0 && <p><Link href={`/v3/profile?case=${caseId}&tab=documents`}>Удалённые пункты и архив документов ({documents.removedSlots.length})</Link></p>}
  </>;
}
