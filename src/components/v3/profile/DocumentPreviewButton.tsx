"use client";

import { useEffect, useId, useRef, useState } from "react";

import { btnGhostCls } from "@/components/ui";

import styles from "./DocumentPreviewButton.module.css";

const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const PREVIEW_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

type PreviewState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; url: string; mimeType: string }>
  | Readonly<{ status: "error"; message: string }>;

type DocumentPreviewProps = Readonly<{
  versionId: string;
  filename: string;
  versionNumber: number;
}>;

/** Only mount for a version whose canonical projection allows download. */
export function DocumentPreviewButton(props: DocumentPreviewProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`${btnGhostCls} min-h-11`}
        aria-haspopup="dialog"
        aria-label={`Просмотреть ${props.filename}, версия ${props.versionNumber}`}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
        data-testid="v3-document-preview"
      >
        Просмотреть
      </button>
      {open ? <DocumentPreviewDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DocumentPreviewDialog({
  versionId,
  filename,
  versionNumber,
  onClose,
}: DocumentPreviewProps & Readonly<{ onClose: () => void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const downloadUrl = `/api/v2/document-versions/${encodeURIComponent(versionId)}/download`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();

    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      data-testid="v3-document-preview-dialog"
    >
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId}>{filename}</h2>
            <p>Оригинал · версия {versionNumber}</p>
          </div>
          <button type="button" className={`${btnGhostCls} min-h-11`} onClick={onClose}>
            Закрыть
          </button>
        </header>
        <DocumentPreviewContent
          key={`${versionId}:${attempt}`}
          downloadUrl={downloadUrl}
          filename={filename}
          onRetry={() => setAttempt((current) => current + 1)}
        />
        <footer className={styles.footer}>
          <p>Если браузер не показывает PDF, скачайте оригинал.</p>
          <a href={downloadUrl} className={`${btnGhostCls} min-h-11`}>
            Скачать оригинал
          </a>
        </footer>
      </div>
    </dialog>
  );
}

function DocumentPreviewContent({
  downloadUrl,
  filename,
  onRetry,
}: Readonly<{ downloadUrl: string; filename: string; onRetry: () => void }>) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 60_000);

    async function load() {
      try {
        // The existing route checks current access, scan/integrity and the exact
        // version before consuming a grant and redirecting to private Storage.
        const response = await fetch(downloadUrl, {
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(response.status === 401 || response.status === 403
            ? "Доступ к файлу не подтверждён. Обновите страницу и проверьте вход в аккаунт."
            : "Хранилище не отдало файл. Попробуйте открыть его ещё раз.");
        }
        const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
        if (!PREVIEW_MIME_TYPES.has(mimeType)) {
          throw new Error("Предпросмотр доступен только для PDF, JPEG и PNG. Файл не был показан.");
        }
        const declaredSize = Number(response.headers.get("content-length"));
        if (declaredSize > MAX_PREVIEW_BYTES) {
          throw new Error("Файл превышает допустимый размер предпросмотра: 25 MiB.");
        }
        const blob = await response.blob();
        if (blob.size < 1 || blob.size > MAX_PREVIEW_BYTES) {
          throw new Error("Хранилище вернуло пустой файл или файл больше 25 MiB.");
        }
        if (disposed) return;
        if (controller.signal.aborted) throw new DOMException("Preview timed out", "AbortError");
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", url: objectUrl, mimeType });
      } catch (error) {
        if (disposed) return;
        setState({
          status: "error",
          message: controller.signal.aborted
            ? "Загрузка заняла слишком много времени. Попробуйте ещё раз."
            : error instanceof TypeError
              ? "Не удалось загрузить файл. Проверьте подключение и повторите попытку."
              : error instanceof Error ? error.message : "Не удалось открыть файл.",
        });
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void load();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [downloadUrl]);

  if (state.status === "loading") {
    return <div className={styles.message} role="status">Загружаем оригинал…</div>;
  }
  if (state.status === "error") {
    return (
      <div className={styles.message}>
        <p role="alert">{state.message}</p>
        <button type="button" className={`${btnGhostCls} min-h-11`} onClick={onRetry}>Повторить</button>
      </div>
    );
  }

  return (
    <div className={styles.viewer}>
      {state.mimeType === "application/pdf" ? (
        <iframe src={state.url} title={`Оригинал: ${filename}`} className={styles.pdf} referrerPolicy="no-referrer" />
      ) : (
        // Private, short-lived Blob URLs must not go through the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={state.url} alt={`Оригинал: ${filename}`} className={styles.image} onError={() => {
          setState({ status: "error", message: "Браузер не смог показать изображение. Попробуйте загрузить его повторно." });
        }} />
      )}
    </div>
  );
}
