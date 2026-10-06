"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import {
  AI_UPLOAD_ACCEPT_ATTRIBUTE,
  AI_UPLOAD_ACCEPT_LABEL,
  aiTitleFromFileName,
  aiUploadErrorCopy,
  aiUploadRetryable,
  checkAiUploadFile,
  formatAiFileSize,
  isAiDocumentTitle,
} from "@/lib/v3/ai-agent-knowledge";

/**
 * Загрузка в «Информацию для агента» (план §4.5, §7): перетащить или выбрать
 * файл, название, аудитория («Для клиентов» — только с подтверждением) и
 * обязательная отметка «Это материал компании, не документ клиента».
 * «Новая версия» наследует аудиторию прежней — её здесь не выбирают.
 *
 * Отправка — `POST /api/v3/ai-agent/documents` (XHR — ради честного процента
 * передачи); после передачи — «Проверяем файл…» (тип, вирусы, запись). Id
 * запроса живёт до записи: «Повторить» после неизвестного итога идёт тем же
 * запросом, и база не создаст второй документ. Каждый выбор файла — новый
 * запрос (тот же id с другими байтами база не примет). Если прошлая попытка
 * уже записала файл, а ввод с тех пор изменился, — «уже загружен» и список
 * перечитывается. До гидратации выбор файла недоступен — выбор без
 * обработчика потерялся бы молча.
 */
const subscribe = () => () => undefined;
const onClient = () => true;
const onServer = () => false;

export type AiUploadReplace = Readonly<{ id: string; title: string; rowVersion: number; audienceLabel: string }>;

type Phase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "sending"; percent: number }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "done"; title: string }>
  | Readonly<{ kind: "error"; code: string; message: string }>;

export function AiDocumentUpload({
  requestId: initialRequestId,
  replace,
  cancelHref,
  featureOn,
}: Readonly<{
  requestId: string;
  replace: AiUploadReplace | null;
  cancelHref: string;
  featureOn: boolean;
}>) {
  const router = useRouter();
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const hydrated = useSyncExternalStore(subscribe, onClient, onServer);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<"client" | "internal">("client");
  const [clientConfirmed, setClientConfirmed] = useState(false);
  const [companyMaterial, setCompanyMaterial] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [attempted, setAttempted] = useState(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => xhrRef.current?.abort(), []);

  const busy = phase.kind === "sending" || phase.kind === "checking";

  const choose = (next: File | null) => {
    if (busy) return;
    setAttempted(false);
    if (!next) return;
    const check = checkAiUploadFile(next.name, next.type, next.size);
    if (!check.ok) {
      setFile(null);
      setPhase({ kind: "error", code: check.code, message: aiUploadErrorCopy(check.code) });
      return;
    }
    // Каждый выбор — новый запрос: прежний id мог уже стать квитанцией
    // другого файла, а одинаковые имя и размер не значат одинаковых байтов.
    setRequestId(crypto.randomUUID());
    setFile(next);
    setTitle(replace ? replace.title : aiTitleFromFileName(next.name));
    setPhase({ kind: "idle" });
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!hydrated) return;
    const dropped = event.dataTransfer.files;
    choose(dropped.length === 1 ? dropped[0]! : null);
    if (dropped.length > 1) setPhase({ kind: "error", code: "one_file", message: "Загружайте по одному файлу." });
  };

  const titleValid = isAiDocumentTitle(title);
  const audienceValid = replace !== null || audience === "internal" || clientConfirmed;
  const ready = file !== null && titleValid && audienceValid && companyMaterial && !busy;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (!ready || !file) return;
    const body = new FormData();
    body.set("file", file);
    body.set("title", title.trim());
    body.set("company_material", "true");
    body.set("request_id", requestId);
    if (replace) {
      body.set("replaces_id", replace.id);
      body.set("replaces_version", String(replace.rowVersion));
    } else {
      body.set("audience", audience);
      body.set("client_confirmed", audience === "client" && clientConfirmed ? "true" : "false");
    }
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/v3/ai-agent/documents");
    xhr.responseType = "json";
    xhr.upload.onprogress = (progress) => {
      if (progress.lengthComputable) setPhase({ kind: "sending", percent: Math.min(99, Math.round((progress.loaded / progress.total) * 100)) });
    };
    xhr.upload.onload = () => setPhase({ kind: "checking" });
    xhr.onload = () => {
      xhrRef.current = null;
      const response = (xhr.response ?? {}) as { error?: { code?: unknown; title?: unknown } };
      if (xhr.status === 201) {
        setPhase({ kind: "done", title: title.trim() });
        setFile(null);
        setTitle("");
        setClientConfirmed(false);
        setCompanyMaterial(false);
        setAttempted(false);
        setRequestId(crypto.randomUUID());
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
        return;
      }
      const code = typeof response.error?.code === "string" ? response.error.code : xhr.status === 413 ? "too_large" : "unavailable";
      const duplicate = typeof response.error?.title === "string" ? response.error.title : null;
      // Окончательный отказ — следующая попытка уже другим запросом.
      if (!aiUploadRetryable(code)) setRequestId(crypto.randomUUID());
      if (code === "already_uploaded") {
        // Файл уже в базе (прошлая попытка): второй раз его не отправить.
        setFile(null);
        setAttempted(false);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
      setPhase({ kind: "error", code, message: aiUploadErrorCopy(code, duplicate) });
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setPhase({ kind: "error", code: "unavailable", message: aiUploadErrorCopy("unavailable") });
    };
    setPhase({ kind: "sending", percent: 0 });
    xhr.send(body);
  };

  const headingId = `${ids}-title`;
  const missing = attempted && !ready && !busy;
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-border bg-surface px-4 py-4 sm:px-5"
      data-testid="v3-ai-upload"
      data-mode={replace ? "replace" : "new"}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="t-section text-fg">
          {replace ? <>Новая версия «{replace.title}»</> : "Загрузить материал"}
        </h2>
        {replace ? (
          <Link href={cancelHref} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
            Отменить
          </Link>
        ) : null}
      </div>
      {replace ? (
        <p className="mt-1 max-w-[70ch] t-body-compact text-fg-2">
          Аудитория прежняя — «{replace.audienceLabel}». Пока новая версия обрабатывается, агент ищет по прежней.
        </p>
      ) : null}
      {!featureOn ? (
        <p className="mt-1 max-w-[70ch] t-body-compact text-fg-2">ИИ-агент не подключён к CRM: файл сохранится и подождёт в очереди.</p>
      ) : null}

      <form className="mt-3 space-y-4" onSubmit={submit} noValidate aria-busy={busy}>
        <label
          className="v3-ai-drop"
          data-dragging={dragging || undefined}
          data-has-file={file ? "" : undefined}
          aria-disabled={!hydrated || busy}
          onDragOver={(event) => { event.preventDefault(); if (hydrated && !busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={AI_UPLOAD_ACCEPT_ATTRIBUTE}
            disabled={!hydrated || busy}
            onChange={(event) => choose(event.currentTarget.files?.[0] ?? null)}
            data-testid="v3-ai-upload-input"
          />
          <Icon name={file ? "file-text" : "upload"} size={20} className="shrink-0 text-fg-2" />
          <span className="min-w-0">
            {file ? (
              <>
                <span className="block break-words t-item text-fg">{file.name}</span>
                <span className="block t-meta text-fg-3">{formatAiFileSize(file.size)} · выбрать другой</span>
              </>
            ) : (
              <>
                <span className="block t-item text-fg">Перетащите файл или <span className="underline underline-offset-4">выберите</span></span>
                <span className="block t-meta text-fg-3">{AI_UPLOAD_ACCEPT_LABEL}</span>
              </>
            )}
          </span>
        </label>

        {file ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <label htmlFor={`${ids}-name`} className="mb-1 block t-label text-fg-2">Название</label>
              <input
                id={`${ids}-name`}
                className="h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg focus-visible:border-accent"
                value={title}
                maxLength={240}
                disabled={busy}
                aria-invalid={attempted && !titleValid ? true : undefined}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
              {attempted && !titleValid ? <p className="mt-1 t-meta text-danger">{aiUploadErrorCopy("invalid_title")}</p> : null}
            </div>
            {replace ? null : (
              <fieldset className="min-w-0">
                <legend className="mb-1 block t-label text-fg-2">Аудитория</legend>
                <div className="flex flex-wrap gap-1" role="radiogroup">
                  {(["client", "internal"] as const).map((value) => (
                    <label key={value} className="v3-ai-choice inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-nav border border-border px-3 t-label text-fg-2">
                      <input
                        type="radio"
                        name={`${ids}-audience`}
                        value={value}
                        checked={audience === value}
                        disabled={busy}
                        onChange={() => setAudience(value)}
                        className="size-4 accent-[var(--text)]"
                      />
                      {value === "client" ? "Для клиентов" : "Внутреннее"}
                    </label>
                  ))}
                </div>
                <p className="mt-1 t-meta text-fg-3">
                  {audience === "client" ? "Агент может цитировать его в ответах клиентам." : "Только для подсказок сотрудникам — клиентам не цитируется."}
                </p>
              </fieldset>
            )}
          </div>
        ) : null}

        {file ? (
          <div className="space-y-1">
            {!replace && audience === "client" ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 t-body-compact text-fg">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--text)]"
                  checked={clientConfirmed}
                  disabled={busy}
                  aria-invalid={attempted && !audienceValid ? true : undefined}
                  onChange={(event) => setClientConfirmed(event.currentTarget.checked)}
                  data-testid="v3-ai-upload-client"
                />
                <span>Подтверждаю: этот материал можно показывать клиентам</span>
              </label>
            ) : null}
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 t-body-compact text-fg">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--text)]"
                checked={companyMaterial}
                disabled={busy}
                aria-invalid={attempted && !companyMaterial ? true : undefined}
                onChange={(event) => setCompanyMaterial(event.currentTarget.checked)}
                data-testid="v3-ai-upload-company"
              />
              <span>
                Это материал компании, не документ клиента
                <span className="block t-meta text-fg-3">Паспорта, аттестаты, дипломы и другие документы клиентов агенту не загружаются.</span>
              </span>
            </label>
          </div>
        ) : null}

        {file ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              className={btnCls}
              aria-disabled={!ready || undefined}
              disabled={busy}
              data-testid="v3-ai-upload-submit"
            >
              {phase.kind === "sending" ? `Загружаем… ${phase.percent}%` : phase.kind === "checking" ? "Проверяем файл…" : replace ? "Загрузить новую версию" : "Загрузить"}
            </button>
            {missing ? (
              <p role="alert" className="t-body-compact text-danger">
                {!companyMaterial ? aiUploadErrorCopy("company_material_required")
                  : !audienceValid ? aiUploadErrorCopy("client_confirmation_required") : aiUploadErrorCopy("invalid_title")}
              </p>
            ) : null}
          </div>
        ) : null}

        {phase.kind === "sending" ? (
          <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-full bg-fg transition-[width] duration-150 ease-out" style={{ width: `${phase.percent}%` }} />
          </div>
        ) : null}
        <div aria-live="polite" data-testid="v3-ai-upload-status">
          {phase.kind === "done" ? (
            <p role="status" className="flex items-center gap-2 t-body-compact text-ok">
              <Icon name="circle-check" size={16} className="shrink-0" />
              «{phase.title}» загружен — обработка в очереди.
            </p>
          ) : null}
          {phase.kind === "error" ? (
            <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 t-body-compact text-danger" data-code={phase.code}>
              <span className="flex items-start gap-2"><Icon name="alert" size={16} className="mt-0.5 shrink-0" />{phase.message}</span>
              {aiUploadRetryable(phase.code) && file ? (
                <button type="submit" className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4">Повторить</button>
              ) : null}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
