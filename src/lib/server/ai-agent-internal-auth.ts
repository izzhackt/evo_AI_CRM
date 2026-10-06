import "server-only";

import { createHash, createHmac } from "node:crypto";

/**
 * CRM → приватный сервис «ИИ-агент» (план §4.3, ADR 0032). Каждый запрос
 * подписан HMAC-SHA256 своим секретом `EVO_AI_AGENT_INTERNAL_SECRET` — это не
 * HMAC WAHA и не секрет lead-agent:
 *
 *   X-EVO-AI-Timestamp: <unix seconds>
 *   X-EVO-AI-Signature: hex(HMAC_SHA256(secret, "<ts>.<METHOD>.<path>.<sha256 hex of body>"))
 *
 * `path` — путь с `?query`, если он есть; допуск по часам у агента — 60 с.
 * Подпись сама по себе диалога не открывает: в теле идёт одноразовый билет,
 * выданный базой по сессии сотрудника (`platform.ai_agent_ticket_v1`).
 *
 * Без секрета (или с секретом короче 32 знаков) функция выключена: окно ИИ
 * честно говорит «не подключён», а CRM выпускается как обычно — имя в
 * контракте env необязательное (`scripts/evo-app-env-contract.mjs`).
 */
export const AI_AGENT_DEFAULT_URL = "http://evo-ai-agent:8080";
export const AI_AGENT_TIMESTAMP_HEADER = "X-EVO-AI-Timestamp";
export const AI_AGENT_SIGNATURE_HEADER = "X-EVO-AI-Signature";

export type AiAgentConfig = Readonly<{ secret: string; baseUrl: string }>;

const LOCAL_AGENT_URL = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|[a-z0-9-]{1,63}):\d{2,5}$/u;

export function readAiAgentConfig(env: Readonly<Record<string, string | undefined>> = process.env): AiAgentConfig | null {
  const secret = (env.EVO_AI_AGENT_INTERNAL_SECRET ?? "").trim();
  if (secret.length < 32 || secret.length > 256 || /\s/u.test(secret)) return null;
  // Адрес агента в production — только внутренний alias сети evo_crm_private;
  // переопределение — для локальной проверки с поддельным агентом.
  const override = env.NODE_ENV === "production" ? "" : (env.EVO_AI_AGENT_URL ?? "").trim();
  return Object.freeze({ secret, baseUrl: LOCAL_AGENT_URL.test(override) ? override : AI_AGENT_DEFAULT_URL });
}

export function aiAgentFeatureOn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return readAiAgentConfig(env) !== null;
}

export function signAiAgentRequest(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string | Uint8Array,
): string {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}.${method.toUpperCase()}.${path}.${digest}`).digest("hex");
}

/** Заголовки подписанного запроса к агенту. */
export function aiAgentSignedHeaders(
  config: AiAgentConfig,
  method: "GET" | "POST",
  path: string,
  body: string,
  nowMs: number,
): Record<string, string> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [AI_AGENT_TIMESTAMP_HEADER]: timestamp,
    [AI_AGENT_SIGNATURE_HEADER]: signAiAgentRequest(config.secret, timestamp, method, path, body),
  };
}
