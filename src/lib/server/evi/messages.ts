import "server-only";

import { EVI_MODEL } from "./prompt.ts";

/*
 * Один вызов Claude Messages API (POST /v1/messages) для Эви — на `fetch`, как клиент ИИ-агентов
 * (src/lib/server/ai-agents/anthropic.ts). Ключ — отдельный `EVO_EVI_ANTHROPIC_API_KEY` (решение владельца 16.11.2026:
 * свой ключ и свой лимит трат в Claude Console, чтобы ученики не тратили бюджет агентов сотрудников); на сервер его
 * кладёт владелец. Ключ, тексты ученика и ответы модели не попадают ни в ошибки, ни в журнал.
 *
 * Запрос (сверено с документацией Claude API 17.11.2026, модель claude-sonnet-5-5): мышление адаптивное — параметр
 * `thinking` не передаётся (у Sonnet 5.5 оно включено всегда; `disabled` — ошибка 400); глубину задаёт
 * `output_config.effort`; ответ — JSON по схеме (`output_config.format`); системный промт — один блок с кешем.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export const EVI_ENV = { apiKey: "EVO_EVI_ANTHROPIC_API_KEY" } as const;

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
/** Мышление считается в `max_tokens`: на итоге модель сверяет все карточки каталога, места нужно с запасом. */
const MAX_TOKENS = 16_000;
/** С 7-го сообщения ученика — окно итога: сверка каталога, где важна строгость. */
const HIGH_EFFORT_FROM = 7;
/** Итог с полной сверкой каталога может думать долго: ответ без потока ждём до 4 минут, и без повтора по таймауту. */
const TIMEOUT_MS = 240_000;
/** Ключ отозван, нет денег или лимит трат на ключе исчерпан, модель недоступна аккаунту — повтор не поможет. */
const ACCOUNT_STATUSES = new Set([401, 402, 403, 404]);
const RETRY_DELAY_MS = 800;

export function readEviApiKey(env: Env): string | null {
  const value = env[EVI_ENV.apiKey]?.trim();
  return value ? value : null;
}

export type EviMessage = Readonly<{ role: "user" | "assistant"; content: string }>;

/**
 * Сбой вызова, без текстов и ключа: `rate_limited` — 429 после повтора; `refused` — модель отказалась отвечать на эту
 * переписку (повтор той же истории снова получит отказ); `unavailable` — ключ или аккаунт не работают (401–404);
 * `failed` — остальное (сеть, таймаут, 5xx, ответ без текста).
 */
export type EviModelErrorCode = "rate_limited" | "refused" | "unavailable" | "failed";

export class EviModelError extends Error {
  readonly code: EviModelErrorCode;
  constructor(code: EviModelErrorCode) {
    super(`Evi model call: ${code}.`);
    this.name = "EviModelError";
    this.code = code;
  }
}

/** Глубина мышления: `medium` на вопросах, `high` с 7-го сообщения ученика (итог и «подбери заново»). */
export function eviEffort(studentMessages: number): "medium" | "high" {
  return studentMessages >= HIGH_EFFORT_FROM ? "high" : "medium";
}

/** Соседние сообщения одной роли склеиваются (API ждёт чередование), разговор начинается с сообщения ученика. */
export function alternate(messages: readonly EviMessage[]): EviMessage[] {
  const merged: EviMessage[] = [];
  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) merged[merged.length - 1] = { role: last.role, content: `${last.content}\n\n${message.content}` };
    else merged.push(message);
  }
  return merged;
}

/** Тело запроса. Без `temperature`, `top_p`, `thinking` и предзаполнения ответа: у Sonnet 5.5 это ошибки 400. */
export function eviRequestBody(options: Readonly<{
  system: string;
  messages: readonly EviMessage[];
  effort: "medium" | "high";
  schema: object;
}>) {
  return {
    model: EVI_MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }],
    messages: alternate(options.messages),
    output_config: { effort: options.effort, format: { type: "json_schema", schema: options.schema } },
  };
}

/**
 * Текст ответа: блоки `text` по типу (перед ними идут пустые блоки мышления). Обрыв по `max_tokens` или ответ без
 * текста — null: ученик видит «не получилось» и «Повторить». Отказ модели (`refusal`) — `EviModelError("refused")`.
 */
export function eviReplyText(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const { content, stop_reason: stopReason } = body as { content?: unknown; stop_reason?: unknown };
  if (stopReason === "refusal") throw new EviModelError("refused");
  if (stopReason === "max_tokens" || !Array.isArray(content)) return null;
  const parts = content
    .filter((part): part is { type: "text"; text: string } => (
      part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string"
    ))
    .map((part) => part.text);
  return parts.length > 0 ? parts.join("") : null;
}

/** Ответ модели. Повтор один раз при 429, 5xx и сбое сети; остальное — сразу `failed`. */
export async function callEviModel(options: Readonly<{
  apiKey: string;
  body: object;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}>): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const body = JSON.stringify(options.body);
  let rateLimited = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    let response: Response;
    try {
      response = await doFetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": options.apiKey, "anthropic-version": API_VERSION },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      // Таймаут — ответ слишком долгий, а не сбой сети: повтор той же переписки снова упрётся в него.
      if (error instanceof DOMException && error.name === "TimeoutError") break;
      continue;
    }
    if (response.ok) {
      const text = eviReplyText(await response.json().catch(() => null));
      if (text === null) throw new EviModelError("failed");
      return text;
    }
    if (ACCOUNT_STATUSES.has(response.status)) throw new EviModelError("unavailable");
    rateLimited = response.status === 429;
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new EviModelError(rateLimited ? "rate_limited" : "failed");
}
