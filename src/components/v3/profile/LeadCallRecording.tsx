"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons";
import type { CallRecordingItem } from "@/lib/v3/telephony-lead-calls";

/** Те же «чипы», что у результата звонка (`LeadCallResult`): 44 px, нажатый — нейтральная плашка. */
const CHIP = "v3-choice inline-flex min-h-11 items-center gap-x-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3";

/** Слова ответа маршрута записи (`/api/v3/telephony/recordings/[legId]`) по коду ошибки. */
const FAILURE_COPY: Readonly<Record<string, string>> = Object.freeze({
  authentication_required: "Войдите снова и повторите.",
  forbidden: "Нет права слушать эту запись.",
  preview: "В просмотре роли записи не воспроизводятся.",
  not_found: "Запись не найдена.",
  recording_unavailable: "Запись недоступна, проверим позже.",
  recording_expired: "Запись удалена по сроку хранения.",
  recording_not_ready: "Запись ещё не готова или временно недоступна.",
  rate_limited: "Слишком много прослушиваний подряд. Повторите чуть позже.",
  not_configured: "Прослушивание записей пока не подключено.",
  recording_temporarily_unavailable: "Запись временно недоступна.",
  unavailable: "Запись временно недоступна.",
});
const FALLBACK_FAILURE = "Не удалось воспроизвести запись. Повторите.";
/** После этих ответов состояние записи в базе изменилось — ленте нужно перечитаться. */
const STATE_CHANGED = new Set(["recording_expired", "recording_unavailable"]);

/** Адрес потока записи: только наш домен и только идентификатор ноги, ссылки источника здесь нет. */
export function recordingStreamPath(legId: string): string {
  return `/api/v3/telephony/recordings/${legId}`;
}

/**
 * Записи звонка в «Ленте» лида («Телефония Beeline KG», срез T6; план §7.4): «Слушать · Менеджер Первый, 2 мин 20 с»
 * (кто говорил и сколько; у звонка из нескольких ног с записями — «Слушать запись 1 из 2»), плеер без кнопки «скачать»,
 * `preload="none"`: звук не грузится, пока сотрудник не нажал. Звук идёт потоком через наш маршрут
 * (копий нет); право, флаг и лимиты решает база при каждом обращении — интерфейс лишь показывает то,
 * что она разрешила, и слова отказа. Если плеер не смог воспроизвести, один пробный запрос
 * `Range: bytes=0-0` узнаёт причину словами маршрута (аудио-элемент код ответа не показывает).
 */
export function LeadCallRecording({ items }: Readonly<{ items: readonly CallRecordingItem[] }>) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function explain(legId: string) {
    let code: string | null = null;
    try {
      const response = await fetch(recordingStreamPath(legId), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Range: "bytes=0-0" },
      });
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
      } else {
        const body = await response.json().then(
          (value: { error?: { code?: unknown } }) => value,
          () => ({} as { error?: { code?: unknown } }),
        );
        code = typeof body.error?.code === "string" ? body.error.code : (response.status === 502 ? "recording_temporarily_unavailable" : null);
      }
    } catch {
      code = null;
    }
    setNote(code !== null && FAILURE_COPY[code] ? FAILURE_COPY[code] : FALLBACK_FAILURE);
    // Плеер, который не заиграл, остаётся мёртвым «0:00 / 0:00»: при любом отказе его убираем, остаётся причина
    // словами и «Слушать» для повтора.
    setOpen(null);
    if (code !== null && STATE_CHANGED.has(code)) {
      // Состояние записи в базе изменилось: лента перечитывает слова состояния.
      router.refresh();
    }
  }

  const players = items.filter((item): item is Extract<CallRecordingItem, { kind: "player" }> => item.kind === "player");
  const texts = items.filter((item): item is Extract<CallRecordingItem, { kind: "text" }> => item.kind === "text");
  return (
    <div className="mt-1" data-testid="v3-call-recording">
      {texts.map((item) => (
        <p key={item.text} className="break-words t-meta text-fg-2">{item.text}</p>
      ))}
      {players.length > 0 ? (
        <div role="group" aria-label="Запись разговора" className="mt-1 flex flex-wrap gap-2">
          {players.map((item) => (
            <button key={item.legId} type="button" className={CHIP} aria-expanded={open === item.legId}
              onClick={() => {
                setNote(null);
                setOpen((current) => (current === item.legId ? null : item.legId));
              }}>
              <Icon name="play" size={14} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {open !== null ? (
        <audio key={open} controls autoPlay preload="none" controlsList="nodownload noplaybackrate"
          aria-label="Запись звонка" className="mt-2 w-full max-w-md" src={recordingStreamPath(open)}
          onError={() => void explain(open)} />
      ) : null}
      <p role="status" aria-live="polite" className="t-meta text-danger">{note}</p>
    </div>
  );
}
