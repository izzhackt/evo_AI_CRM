"use client";

import { useId, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

import { PortalDocumentControls } from "./PortalDocumentControls";

export type UploadableDocument = Readonly<{
  documentSlotId: string;
  label: string;
  instructions: string | null;
  documentVersionId: string | null;
  originalFilename: string | null;
}>;

/**
 * «Загрузить документ» над чек-листом (03.11.2026, по образцу кабинета
 * пользователя): окно, где студент выбирает, какой документ из чек-листа он
 * присылает, и загружает файл. Своей загрузки у окна нет: для выбранного
 * документа рисуется тот же PortalDocumentControls, что в строке чек-листа
 * (тот же XHR-путь, ключ идемпотентности, проверка квитанции и обновление
 * списка). Свободного «архива» с разделами и названием файла нет: документ
 * всегда ложится в строку чек-листа, которую завёл куратор.
 */
export function DocumentUploadDialog({ documents, locale }: Readonly<{
  /** Строки чек-листа, куда можно загрузить файл (не принятые). */
  documents: readonly UploadableDocument[];
  locale: Locale;
}>) {
  const strings = getPortalStrings("admission", locale);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selectId = useId();
  const [selectedId, setSelectedId] = useState(documents[0]?.documentSlotId ?? "");
  const selected = documents.find((document) => document.documentSlotId === selectedId) ?? documents[0] ?? null;

  if (documents.length === 0) return null;

  return (
    <>
      <button type="button" className="pt-btn pt-docs-upload-open" onClick={() => dialogRef.current?.showModal()}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {strings.uploadDialogOpen}
      </button>
      <dialog ref={dialogRef} className="pt-docs-dialog" aria-labelledby={titleId}>
        <div className="pt-docs-dialog-head">
          <h2 id={titleId} className="pt-docs-dialog-title">{strings.uploadDialogOpen}</h2>
          <button
            type="button"
            className="pt-docs-dialog-close"
            aria-label={strings.uploadDialogClose}
            onClick={() => dialogRef.current?.close()}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="pt-docs-dialog-body">
          <label htmlFor={selectId} className="pt-docs-dialog-label">{strings.uploadDialogSelect}</label>
          {/* Фокус при открытии — на выборе документа, первом шаге окна. */}
          <select
            id={selectId}
            autoFocus
            className="pt-docs-dialog-select"
            value={selected?.documentSlotId ?? ""}
            onChange={(event) => setSelectedId(event.currentTarget.value)}
          >
            {documents.map((document) => (
              <option key={document.documentSlotId} value={document.documentSlotId}>{document.label}</option>
            ))}
          </select>
          {selected?.instructions ? <p className="pt-docs-dialog-note">{selected.instructions}</p> : null}
          {selected ? (
            <PortalDocumentControls
              key={selected.documentSlotId}
              documentSlotId={selected.documentSlotId}
              documentVersionId={selected.documentVersionId}
              originalFilename={selected.originalFilename}
              allowUpload
              locale={locale}
              idScope="dialog-"
            />
          ) : null}
          <p className="pt-docs-dialog-note">{strings.uploadHint}</p>
        </div>
        <div className="pt-docs-dialog-foot">
          <button type="button" className="pt-btn-ghost" onClick={() => dialogRef.current?.close()}>
            {strings.uploadDialogDone}
          </button>
        </div>
      </dialog>
    </>
  );
}
