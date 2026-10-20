"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import {
  WHATSAPP_CONNECT_ANCHOR,
  WHATSAPP_CONNECT_CODE_SHOWN_MS,
  WHATSAPP_CONNECT_PATH,
  WHATSAPP_CONNECT_POLL_MS,
  WHATSAPP_CONNECT_QR_REFRESH_MS,
  WHATSAPP_CONNECT_WINDOW_MS,
  normalizePairingPhone,
  parseWhatsAppConnectError,
  parseWhatsAppConnectReply,
  type WhatsAppConnectErrorCode,
  type WhatsAppConnectReply,
} from "@/lib/v3/whatsapp-connect-contract";
import { whatsappConnectError, whatsappConnectionState, whatsappConnectWords, whatsappRateLimited } from "@/lib/v3/wording";

/**
 * «Подключение WhatsApp» (решение владельца 20.10.2026): привязать рабочий номер
 * к CRM в любой момент, с компьютера или с одного телефона.
 *
 * Два пути, оба через `POST /api/v3/settings/whatsapp-connect` (адрес и ключ WAHA
 * остаются на сервере): «Подключить» запускает сессию и показывает QR, который
 * обновляется сам; «Получить код» по номеру телефона даёт код для WhatsApp на том
 * же телефоне. Пока идёт подключение, блок раз в несколько секунд спрашивает
 * состояние; на «Подключено» опрос заканчивается.
 *
 * Номер живёт только в поле формы и в одном запросе: он не пишется ни в адрес, ни
 * в хранилище браузера, а после полученного кода поле очищается. QR и код живут
 * в памяти страницы и исчезают вместе с ней. «Отключить» и «Выйти» здесь нет и
 * не будет: это решение владельца, а не кнопка.
 */

type PostResult =
  | Readonly<{ ok: true; reply: WhatsAppConnectReply }>
  | Readonly<{ ok: false; http: number; code: WhatsAppConnectErrorCode | null; retryAfterSeconds: number | null }>;

/** Дольше всего отвечает «Получить код»: ожидание запуска до 20 с (с чтением состояния до 5 с за шаг) и ответ WAHA до 30 с. */
const REQUEST_LIMIT_MS = 90_000;

async function post(body: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<PostResult> {
  // Свой таймер и свой контроллер, без `AbortSignal.any`/`timeout`: на телефоне владельца может быть
  // Safari, где их ещё нет, и тогда блок молча не работал бы вовсе.
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = window.setTimeout(stop, REQUEST_LIMIT_MS);
  if (signal?.aborted) stop();
  signal?.addEventListener("abort", stop);
  try {
    const response = await fetch(WHATSAPP_CONNECT_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const reply = parseWhatsAppConnectReply(parsed);
      if (reply) return { ok: true, reply };
      return { ok: false, http: 502, code: "provider_unavailable", retryAfterSeconds: null };
    }
    return { ok: false, http: response.status, ...parseWhatsAppConnectError(parsed) };
  } catch {
    return { ok: false, http: 0, code: "unavailable", retryAfterSeconds: null };
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

/** Ждём сканирования или запуска: только в этих состояниях имеет смысл держать окно подключения открытым. */
const isWaiting = (status: string | null | undefined) => whatsappConnectionState(status)?.tone === "warn";

const fieldCls = "h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";

export function WhatsAppConnectSection({
  initialStatus,
  canConnect,
}: Readonly<{
  /** Слово WAHA, прочитанное сервером при отрисовке страницы; `null` — не определено. */
  initialStatus: string | null;
  /** Только Администратор вне просмотра роли; сервер проверяет то же самое ещё раз. */
  canConnect: boolean;
}>) {
  const headingId = useId();
  const phoneId = useId();
  const phoneHintId = useId();
  const codeTitleId = useId();
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [codeStale, setCodeStale] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"connect" | "code" | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const qrAtRef = useRef(0);
  const windowEndsRef = useRef(0);
  const delayRef = useRef(WHATSAPP_CONNECT_POLL_MS);
  const failuresRef = useRef(0);
  const codeShownRef = useRef(false);

  const state = whatsappConnectionState(status);
  const working = status === "WORKING";

  const applyReply = useCallback((reply: WhatsAppConnectReply) => {
    if (reply.status) setStatus(reply.status);
    if (reply.status === "WORKING") {
      setPolling(false);
      setQr(null);
      setCode(null);
      setCodeStale(false);
      setError(null);
      setNotice(whatsappConnectWords.connect.connected);
      return;
    }
    // Состояние, при котором ждать нечего: ошибка (нажать «Подключить» ещё раз) или слово,
    // которого блок не знает. Опрос на этом заканчивается, чип или честное «не удалось определить» остаются.
    if (reply.status === "FAILED" || (reply.status && !whatsappConnectionState(reply.status))) {
      setPolling(false);
      setQr(null);
      qrAtRef.current = 0;
      return;
    }
    if (reply.qr) {
      setQr(reply.qr);
      qrAtRef.current = Date.now();
    } else if (reply.status !== "SCAN_QR_CODE") {
      setQr(null);
      qrAtRef.current = 0;
    }
  }, []);

  const failWith = useCallback((code: WhatsAppConnectErrorCode | null, retryAfterSeconds: number | null = null) => {
    setError(
      code === "rate_limited" && retryAfterSeconds !== null
        ? whatsappRateLimited(retryAfterSeconds)
        : whatsappConnectError(code) ?? whatsappConnectWords.errors.unavailable,
    );
  }, []);

  // Опрос состояния, пока открыто окно подключения: одно ожидание за раз, QR — не чаще раза в 10 с.
  useEffect(() => {
    if (!polling) return undefined;
    const controller = new AbortController();
    let timer: number | undefined;
    const tick = async () => {
      if (controller.signal.aborted) return;
      if (Date.now() > windowEndsRef.current) {
        setPolling(false);
        setQr(null);
        setNotice(whatsappConnectWords.connect.windowEnded);
        return;
      }
      if (document.visibilityState === "visible") {
        // Пока на экране код по номеру, QR не запрашиваем: лишняя выдача картинки не нужна.
        const withQr = !codeShownRef.current && Date.now() - qrAtRef.current >= WHATSAPP_CONNECT_QR_REFRESH_MS;
        const result = await post({ action: "status", withQr }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          failuresRef.current = 0;
          delayRef.current = WHATSAPP_CONNECT_POLL_MS;
          setError(null);
          applyReply(result.reply);
          if (result.reply.status === "WORKING") return;
        } else if (result.code === "authentication_required" || result.code === "forbidden" || result.code === "preview") {
          setPolling(false);
          failWith(result.code);
          return;
        } else if (result.code === "rate_limited") {
          delayRef.current = Math.max(WHATSAPP_CONNECT_POLL_MS, (result.retryAfterSeconds ?? 0) * 1_000);
        } else {
          failuresRef.current += 1;
          if (failuresRef.current >= 5) {
            setPolling(false);
            failWith(result.code);
            return;
          }
        }
      }
      timer = window.setTimeout(tick, delayRef.current);
    };
    timer = window.setTimeout(tick, WHATSAPP_CONNECT_POLL_MS);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [polling, applyReply, failWith]);

  // Опросу нужно знать, показан ли код, не перезапускаясь при каждом его появлении.
  useEffect(() => {
    codeShownRef.current = code !== null;
  }, [code]);

  // Код живёт на экране недолго: старый WhatsApp всё равно не примет.
  useEffect(() => {
    if (!code) return undefined;
    const timer = window.setTimeout(() => {
      setCode(null);
      setCodeStale(true);
    }, WHATSAPP_CONNECT_CODE_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [code]);

  const openWindow = () => {
    windowEndsRef.current = Date.now() + WHATSAPP_CONNECT_WINDOW_MS;
    failuresRef.current = 0;
    delayRef.current = WHATSAPP_CONNECT_POLL_MS;
    qrAtRef.current = 0;
    setPolling(true);
  };

  async function connect() {
    if (busy || !canConnect) return;
    setBusy("connect");
    setError(null);
    setNotice(null);
    setCode(null);
    setCodeStale(false);
    const result = await post({ action: "connect" });
    setBusy(null);
    if (!result.ok) {
      failWith(result.code, result.retryAfterSeconds);
      return;
    }
    applyReply(result.reply);
    if (isWaiting(result.reply.status)) openWindow();
  }

  async function requestCode() {
    if (busy || !canConnect) return;
    const normalized = normalizePairingPhone(phone);
    if (normalized === null) {
      setPhoneError(whatsappConnectWords.errors.invalid_phone);
      return;
    }
    setPhoneError(null);
    setBusy("code");
    setError(null);
    setNotice(null);
    setCodeStale(false);
    const result = await post({ action: "code", phone: normalized });
    setBusy(null);
    if (!result.ok) {
      if (result.code === "invalid_phone" || result.code === "phone_rejected") setPhoneError(whatsappConnectError(result.code));
      else if (result.code === "already_connected") {
        // Пока мы просили код, номер уже привязали: показываем настоящее состояние, а не старое.
        applyReply({ status: "WORKING", qr: null, code: null });
      } else failWith(result.code, result.retryAfterSeconds);
      return;
    }
    // Номер больше не нужен: поле очищается, в браузере он не остаётся.
    setPhone("");
    applyReply(result.reply);
    if (result.reply.code) {
      setCode(result.reply.code);
      // QR, оставшийся от прежней попытки, больше не нужен и не должен мелькнуть, когда код погаснет.
      setQr(null);
      qrAtRef.current = 0;
      if (isWaiting(result.reply.status)) openWindow();
    }
  }

  const words = whatsappConnectWords;
  // Пока на экране код по номеру, QR не нужен: он только запутал бы того, кто привязывает с одного телефона.
  const qrFlow = polling && !code;
  const scanning = qrFlow && status === "SCAN_QR_CODE";
  const starting = qrFlow && !scanning;
  const announcement = notice ?? (scanning ? (qr ? words.connect.scanSteps : words.connect.waitingQr) : starting ? words.connect.starting : codeStale && !code ? words.code.expired : "");

  return (
    <section
      id={WHATSAPP_CONNECT_ANCHOR}
      aria-labelledby={headingId}
      data-testid="v3-whatsapp-connect"
      data-tone={state?.tone}
      className="@container/connect mt-5 scroll-mt-4 overflow-hidden rounded-card border border-border bg-surface"
    >
      <h3 id={headingId} className="t-section flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-fg">
        {words.title}
        {state ? <StatusChip label={state.label} tone={state.tone} /> : null}
      </h3>

      <div className="space-y-4 px-4 py-4">
        <p className="t-body-compact max-w-[var(--type-measure)] text-fg-2">
          {working ? words.working : words.lead}
          {!state ? <span className="block text-fg-3">{words.stateUnknown}</span> : null}
        </p>

        {!working && !canConnect ? (
          <p className="flex items-start gap-1.5 t-body-compact text-fg-2" data-testid="v3-whatsapp-connect-preview">
            <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
            <span>{words.previewOnly}</span>
          </p>
        ) : null}

        {!working && canConnect ? (
          <div className="grid gap-5 @min-[44rem]/connect:grid-cols-2 @min-[44rem]/connect:gap-8">
            <div data-testid="v3-whatsapp-connect-qr" className="min-w-0">
              <p className="t-item text-fg">{words.connect.scanTitle}</p>
              <p className="mt-1 t-body-compact text-fg-2">{words.connect.hint}</p>
              <div className="mt-3">
                <button type="button" className={`${btnCls} w-full @min-[44rem]/connect:w-auto`} onClick={() => void connect()} disabled={busy !== null} aria-busy={busy === "connect"}>
                  {busy === "connect" ? words.connect.busy : words.connect.button}
                </button>
              </div>
              {starting ? <p className="mt-3 t-body-compact text-fg-2">{qr ? words.connect.scanSteps : words.connect.starting}</p> : null}
              {scanning ? (
                <div className="mt-3">
                  {qr ? (
                    <>
                      <div className="mx-auto w-full max-w-64 rounded-ctl border border-border bg-surface p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element -- одноразовая картинка data:, оптимизатору нечего делать */}
                        <img src={qr} alt={words.connect.qrAlt} width={292} height={292} className="block h-auto w-full" data-testid="v3-whatsapp-qr" />
                      </div>
                      <p className="mt-3 t-body-compact text-fg-2">{words.connect.scanSteps}</p>
                    </>
                  ) : (
                    <p className="t-body-compact text-fg-2">{words.connect.waitingQr}</p>
                  )}
                </div>
              ) : null}
            </div>

            <form
              className="min-w-0 @min-[44rem]/connect:border-s @min-[44rem]/connect:border-border @min-[44rem]/connect:ps-8"
              data-testid="v3-whatsapp-connect-code"
              noValidate
              onSubmit={(event) => { event.preventDefault(); void requestCode(); }}
            >
              <p className="t-item text-fg">{words.code.title}</p>
              <p className="mt-1 t-body-compact text-fg-2">{words.code.hint}</p>
              <label htmlFor={phoneId} className="mt-3 block t-label text-fg-2">{words.code.phoneLabel}</label>
              <input
                id={phoneId}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={32}
                value={phone}
                placeholder={words.code.phonePlaceholder}
                aria-invalid={phoneError ? true : undefined}
                aria-describedby={phoneHintId}
                onChange={(event) => { setPhone(event.target.value); setPhoneError(null); }}
                className={`${fieldCls} mt-1`}
              />
              <p id={phoneHintId} className="mt-1 t-meta text-fg-3">{words.code.phoneHint}</p>
              {phoneError ? (
                <p className="mt-1 flex items-start gap-1.5 t-body-compact text-danger" role="alert">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                  <span>{phoneError}</span>
                </p>
              ) : null}
              <div className="mt-3">
                <button type="submit" className={`${btnGhostCls} w-full @min-[44rem]/connect:w-auto`} disabled={busy !== null} aria-busy={busy === "code"}>
                  {busy === "code" ? words.code.busy : words.code.button}
                </button>
              </div>
              {code ? (
                <div role="group" aria-labelledby={codeTitleId} className="mt-4 rounded-ctl border border-border bg-surface-2 px-4 py-3" data-testid="v3-whatsapp-code-result">
                  <p id={codeTitleId} className="t-caption text-fg-2">{words.code.resultTitle}</p>
                  <p className="t-figure mt-1 select-all break-all font-mono text-fg" data-testid="v3-whatsapp-code">{code}</p>
                  <p className="mt-2 t-body-compact text-fg-2">{words.code.steps}</p>
                </div>
              ) : null}
              {codeStale && !code ? <p className="mt-3 t-body-compact text-fg-2">{words.code.expired}</p> : null}
            </form>
          </div>
        ) : null}

        {error ? (
          <p className="flex items-start gap-1.5 t-body-compact text-danger" role="alert" data-testid="v3-whatsapp-connect-error">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
        {/* «Готово» при подключении слышит читалка; на экране то же уже сказано абзацем выше и чипом. */}
        {notice && !working ? <p className="t-body-compact text-fg" data-testid="v3-whatsapp-connect-notice">{notice}</p> : null}
      </div>
      {/* Одна постоянная область для читалки: текст, появившийся вместе с самой областью, многие читалки не озвучивают.
          Стоит вне контейнера с `space-y-4`: последний потомок, даже скрытый, дал бы видимому блоку лишние 16 px снизу. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="v3-whatsapp-connect-live">{announcement}</p>
    </section>
  );
}
