// «Подбор с Эви»: один вызов POST {portal}/api/portal/mobile/evi с Bearer-токеном (веб: серверное действие askEviAction).
// Ответ сервера - тот же EviActionResult; здесь он строго разбирается, а все сбои транспорта сводятся к тем же шести
// исходам (EviFailure), что и на вебе: экран показывает ту же строку и то же одно действие. Тексты ответов сервера и
// ошибок наружу не отдаются.
import { isEviMood, type EviActionResult, type EviAnswer, type EviProgress, type EviResult, type EviTurn } from "@web/lib/portal/evi";

export type EviFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Модель может думать до 4 минут (итог со сверкой каталога): ждём чуть дольше серверного предела. */
const TIMEOUT_MS = 250_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProgress(value: unknown): EviProgress | null {
  if (!isRecord(value) || !Number.isInteger(value.step) || !Number.isInteger(value.total)) return null;
  return { step: value.step as number, total: value.total as number };
}

function parseResults(value: unknown): readonly EviResult[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const results: EviResult[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.cardId !== "string" || typeof item.cardKey !== "string" || typeof item.title !== "string" || typeof item.why !== "string") return undefined;
    if (item.summary !== null && typeof item.summary !== "string") return undefined;
    results.push({ cardId: item.cardId, cardKey: item.cardKey, title: item.title, summary: item.summary, why: item.why });
  }
  return results;
}

/** Разбор тела ответа сервера; чужая форма - `null` (экран покажет «Не получилось ответить»). */
export function parseEviActionResult(value: unknown): EviActionResult | null {
  if (!isRecord(value)) return null;
  if (value.ok === false) {
    const reason = value.reason;
    return reason === "consent" || reason === "unavailable" || reason === "limit" || reason === "busy" || reason === "invalid" || reason === "error"
      ? { ok: false, reason }
      : null;
  }
  const answer = value.ok === true ? value.answer : null;
  if (!isRecord(answer) || typeof answer.message !== "string" || answer.message.length === 0 || !isEviMood(answer.mood)) return null;
  if (!Array.isArray(answer.options) || !answer.options.every((option) => typeof option === "string") || typeof answer.multi !== "boolean") return null;
  const results = parseResults(answer.results);
  if (results === undefined) return null;
  const parsed: EviAnswer = {
    message: answer.message,
    mood: answer.mood,
    options: answer.options as string[],
    multi: answer.multi,
    results,
    progress: parseProgress(answer.progress),
  };
  return { ok: true, answer: parsed };
}

export type EviApi = Readonly<{
  ask: (history: EviTurn[], lang: "ru" | "ky") => Promise<EviActionResult>;
}>;

/**
 * `getToken` отдаёт актуальный access token сессии, `refreshToken` - обновляет её один раз на 401 (как скачивание и
 * загрузка документов). Токен уходит только на адрес портала.
 */
export function createEviApi(options: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  refreshToken?: () => Promise<string | null>;
  fetch?: EviFetch;
}): EviApi {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch: EviFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function send(token: string, body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await doFetch(`${base}/api/portal/mobile/evi`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async ask(history, lang) {
      const body = JSON.stringify({ history, locale: lang });
      try {
        let token = await options.getToken();
        if (!token) return { ok: false, reason: "error" };
        let response = await send(token, body);
        if (response.status === 401 && options.refreshToken) {
          token = await options.refreshToken();
          if (!token) return { ok: false, reason: "error" };
          response = await send(token, body);
        }
        if (response.status === 200) {
          let json: unknown = null;
          try {
            json = await response.json();
          } catch {
            json = null;
          }
          return parseEviActionResult(json) ?? { ok: false, reason: "error" };
        }
        // 403: аккаунт не студент кабинета; 429: частота на входе; 400: сервер не принял форму разговора.
        if (response.status === 403) return { ok: false, reason: "unavailable" };
        if (response.status === 429) return { ok: false, reason: "busy" };
        if (response.status === 400) return { ok: false, reason: "invalid" };
        return { ok: false, reason: "error" };
      } catch {
        return { ok: false, reason: "error" };
      }
    },
  };
}
