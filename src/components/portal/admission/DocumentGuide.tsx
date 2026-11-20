"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { documentGuideView, type DocumentGuideView } from "@/lib/portal/document-guides";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";

import { DocumentGuideBody, SampleFigure, SampleLegend } from "./DocumentGuideBody";
import { CloseIcon, DownloadIcon, GuideMarkIcon } from "./DocumentGuideIcons";
import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalStatus } from "./PortalStatus";
import type { PortalStatusTone } from "./presentation";

const CHAT_HREF = "/portal/messages?view=chat";

type Upload = {
  documentSlotId: string;
  documentVersionId: string | null;
  originalFilename: string | null;
};

/**
 * Кнопка «Образец и советы» и панель «что это за документ».
 * Панель — системный `<dialog>`: Esc, ловушка фокуса и возврат фокуса даёт браузер.
 * На телефоне та же панель становится нижним листом (portal.css).
 */
export function DocumentGuideSlot({
  label,
  requirementKey,
  locale,
  country = null,
  statusLabel = null,
  statusTone = "neutral",
  upload = null,
  download = null,
}: {
  label: string;
  requirementKey: string | null;
  locale: Locale;
  /** Страна дела (`CN`…): добавляет её требования к документу. */
  country?: string | null;
  statusLabel?: string | null;
  statusTone?: PortalStatusTone;
  /** Существующая загрузка строки. Рисуется, когда файл ещё не принят. */
  upload?: Upload | null;
  /** Скачивание принятого файла или договора/чека. */
  download?: { href: string; filename: string } | null;
}) {
  const guide = documentGuideView({ requirementKey, label }, locale, country);
  if (!guide) return null;
  return (
    <DocumentGuide
      label={label}
      locale={locale}
      guide={guide}
      statusLabel={statusLabel}
      statusTone={statusTone}
      upload={upload}
      download={download}
    />
  );
}

function DocumentGuide({
  label,
  locale,
  guide,
  statusLabel,
  statusTone,
  upload,
  download,
}: {
  label: string;
  locale: Locale;
  guide: DocumentGuideView;
  statusLabel: string | null;
  statusTone: PortalStatusTone;
  upload: Upload | null;
  download: { href: string; filename: string } | null;
}) {
  const strings = getPortalStrings("admission", locale);
  const titleId = useId();
  const sampleTitleId = useId();
  const dialogId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sampleRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const sampleOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  function openGuide() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    setOpen(true);
    dialog.showModal();
  }

  function openSample(button: HTMLButtonElement) {
    const dialog = sampleRef.current;
    if (!dialog || dialog.open) return;
    sampleOpenerRef.current = button;
    dialog.showModal();
  }

  const action = download ? (
    <a
      className="pt-btn pt-doc-guide-download"
      href={download.href}
      aria-label={formatPortalString(strings.downloadAria, { name: download.filename || strings.lastFileFallback })}
    >
      <DownloadIcon />
      {strings.downloadButton}
    </a>
  ) : upload ? (
    <PortalDocumentControls
      documentSlotId={upload.documentSlotId}
      documentVersionId={upload.documentVersionId}
      originalFilename={upload.originalFilename}
      allowUpload
      locale={locale}
      idScope="guide-"
      placement="drawer"
    />
  ) : null;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="pt-doc-guide-btn"
        aria-label={formatPortalString(strings.guideButtonAria, { name: label })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={openGuide}
      >
        <span className="pt-doc-guide-btn-mark"><GuideMarkIcon /></span>
        <span className="pt-doc-guide-btn-label">{strings.guideButton}</span>
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        className="pt-doc-guide-dialog"
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onClose={() => {
          if (sampleRef.current?.open) sampleRef.current.close();
          setOpen(false);
          openerRef.current?.focus();
        }}
      >
        <div className="pt-doc-guide-panel">
          <header className="pt-doc-guide-head">
            <div className="pt-doc-guide-heading">
              <h2 id={titleId}>{label}</h2>
              {statusLabel ? <PortalStatus label={statusLabel} tone={statusTone} /> : null}
            </div>
            <button type="button" className="pt-doc-guide-close" onClick={() => dialogRef.current?.close()}>
              <CloseIcon />
              <span className="pt-sr-only">{strings.guideClose}</span>
            </button>
          </header>
          <div className="pt-doc-guide-body" tabIndex={0} role="region" aria-label={label}>
            <DocumentGuideBody guide={guide} strings={strings} titleId={titleId} onOpenSample={openSample} />
          </div>
          <footer className="pt-doc-guide-foot">
            <div className="pt-doc-guide-actions">
              {action}
              <Link className="pt-link pt-doc-guide-ask" href={CHAT_HREF}>{strings.guideAskCurator}</Link>
            </div>
          </footer>
        </div>
      </dialog>
      <dialog
        ref={sampleRef}
        className="pt-doc-guide-lightbox"
        aria-labelledby={sampleTitleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onClose={() => {
          if (dialogRef.current?.open) sampleOpenerRef.current?.focus();
        }}
      >
        <div className="pt-doc-guide-lightbox-panel">
          <button type="button" className="pt-doc-guide-close" onClick={() => sampleRef.current?.close()}>
            <CloseIcon />
            <span className="pt-sr-only">{strings.guideSampleClose}</span>
          </button>
          <h2 id={sampleTitleId} className="pt-sr-only">{strings.guideSampleOpen}</h2>
          <SampleFigure guide={guide} enlarged />
          <SampleLegend guide={guide} />
        </div>
      </dialog>
    </>
  );
}
