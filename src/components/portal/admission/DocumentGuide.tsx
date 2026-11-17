"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { documentGuideView, type DocumentGuideView } from "@/lib/portal/document-guides";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";

import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalStatus } from "./PortalStatus";
import type { PortalStatusTone } from "./presentation";

const CHAT_HREF = "/portal/messages?view=chat";
const PROGRAMS_HREF = "/portal?view=programs#list";

/**
 * Кнопка «!» и панель «что это за документ».
 * Панель — системный `<dialog>`: Esc, ловушка фокуса и возврат фокуса даёт браузер.
 * На телефоне та же панель становится нижним листом (portal.css).
 */
export function DocumentGuideSlot({
  label,
  requirementKey,
  locale,
  statusLabel = null,
  statusTone = "neutral",
  upload = null,
  download = null,
}: {
  label: string;
  requirementKey: string | null;
  locale: Locale;
  statusLabel?: string | null;
  statusTone?: PortalStatusTone;
  /** Существующая загрузка строки. Рисуется, когда файл ещё не принят. */
  upload?: {
    documentSlotId: string;
    documentVersionId: string | null;
    originalFilename: string | null;
  } | null;
  /** Скачивание принятого файла или договора/чека. */
  download?: { href: string; filename: string } | null;
}) {
  const guide = documentGuideView({ requirementKey, label }, locale);
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
  upload: {
    documentSlotId: string;
    documentVersionId: string | null;
    originalFilename: string | null;
  } | null;
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
        data-tooltip={strings.guideTooltip}
        aria-label={formatPortalString(strings.guideOpenAria, { name: label })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={openGuide}
      >
        <InfoIcon />
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
            <p className="pt-doc-guide-lead">{guide.description}</p>
            <section className="pt-doc-guide-where" aria-labelledby={`${titleId}-where`}>
              <h3 id={`${titleId}-where`}>{strings.guideWhere}</h3>
              <ul>
                {guide.where.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </section>
            <div className="pt-doc-guide-sample-head">
              <p className="pt-doc-guide-req">{guide.requirements}</p>
              <button type="button" className="pt-doc-guide-chip" onClick={(event) => openSample(event.currentTarget)}>
                {strings.guideSample}
                <ExpandIcon />
              </button>
            </div>
            <button
              type="button"
              className="pt-doc-guide-hero"
              aria-label={strings.guideSampleOpen}
              onClick={(event) => openSample(event.currentTarget)}
            >
              <SampleFigure guide={guide} />
            </button>
            <p className="pt-doc-guide-legend">
              {guide.pins.map((pin, index) => (
                <span key={pin.n}>
                  {index > 0 ? <span className="pt-doc-guide-dot" aria-hidden="true">·</span> : null}
                  <i aria-hidden="true">{pin.n}</i>
                  {pin.legend}
                </span>
              ))}
            </p>
            <p className="pt-doc-guide-mistakes">{guide.mistakes}</p>
            <p className="pt-doc-guide-university">
              {strings.guideUniversityNote}{" "}
              <Link className="pt-link" href={PROGRAMS_HREF}>{strings.guideUniversityLink}</Link>
            </p>
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
          <p className="pt-doc-guide-legend">
            {guide.pins.map((pin) => (
              <span key={pin.n}><i aria-hidden="true">{pin.n}</i>{pin.legend}</span>
            ))}
          </p>
        </div>
      </dialog>
    </>
  );
}

function SampleFigure({ guide, enlarged = false }: { guide: DocumentGuideView; enlarged?: boolean }) {
  return (
    <span className={enlarged ? "pt-doc-guide-figure is-large" : "pt-doc-guide-figure"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- статический SVG-образец из public/, оптимизатор не нужен */}
      <img src={guide.sampleSrc} alt="" width={640} height={400} decoding="async" />
      {guide.pins.map((pin) => (
        <span
          key={pin.n}
          className="pt-doc-guide-pin"
          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
          aria-hidden="true"
        >
          {pin.n}
        </span>
      ))}
    </span>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.35" />
      <path d="M8 4.85v3.45" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="11.15" r="1.05" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v12M8 12l4 4 4-4M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
