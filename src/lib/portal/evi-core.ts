import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Locale } from "../i18n-data.ts";
import { takeEviSlot } from "../server/evi/limiter.ts";
import { callEviModel, eviEffort, EviModelError, eviRequestBody, readEviApiKey, type Env } from "../server/evi/messages.ts";
import { eviOpening, eviReplySchema, eviSystemPrompt } from "../server/evi/prompt.ts";
import { aiConsentState } from "./ai-consent.ts";
import { readAiConsentForProfile } from "./ai-consent-rpc.ts";
import {
  extractJsonObject,
  historyTooLong,
  parseEviHistory,
  parseEviReply,
  type EviActionResult,
} from "./evi.ts";
import type { OrvisState } from "./profession-guide.ts";
import type { ProfessionCard } from "./professions.ts";

/**
 * Один ход разговора с Эви — общее ядро веба (серверное действие `askEviAction`, сессия в cookie) и мобильного
 * приложения (`POST /api/portal/mobile/evi`, Bearer). Оба входа сначала сами устанавливают, кто спрашивает, и отдают сюда
 * клиент сессии ЭТОГО ученика: согласие, каталог и тест интересов читаются его правами, а не служебными. Промт, пределы,
 * согласие, частота и разбор ответа живут только здесь.
 *
 * Порядок проверок — до любого вызова модели: форма и длина истории, согласие на ИИ-помощников (читается заново: страница
 * не проверяет это за действие), ключ Эви в окружении, частота вызовов. В модель уходят только переписка, которую ученик
 * видит на экране, и результат его собственного теста интересов словами (решение владельца 17.11.2026); дело, документы
 * и профиль — нет. Ничего не сохраняется: разговор живёт, пока открыт кабинет.
 */

/** Только то, что ядру нужно знать о вошедшем студенте: уровень доступа (согласие) и его идентификатор (частота). */
export type EviCoreActor = Readonly<{ accessTier: unknown; authUserId: string }>;

/**
 * Подмены для проверок: окружение с ключом, сетевой вызов к модели и чтения каталога и теста интересов (они ходят в
 * базу правами переданного клиента и тянут cookie-слой Next, которого в проверках без сервера нет). По умолчанию — настоящие.
 */
export type EviCoreDependencies = Readonly<{
  env?: Env;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  readCatalog?: (client: SupabaseClient) => Promise<readonly ProfessionCard[]>;
  readOrvis?: (client: SupabaseClient) => Promise<OrvisState | null>;
}>;

async function defaultReadCatalog(client: SupabaseClient): Promise<readonly ProfessionCard[]> {
  return (await import("../server/evi/catalog")).readEviCatalog(client);
}

async function defaultReadOrvis(client: SupabaseClient): Promise<OrvisState | null> {
  return (await import("./professions-source")).readOwnOrvisState(client);
}

export async function runEviTurn(
  input: Readonly<{ history: unknown; actor: EviCoreActor; client: SupabaseClient; locale: Locale }>,
  dependencies: EviCoreDependencies = {},
): Promise<EviActionResult> {
  const { history, actor, client, locale } = input;
  if (historyTooLong(history)) return { ok: false, reason: "limit" };
  const turns = parseEviHistory(history);
  if (turns === null) return { ok: false, reason: "invalid" };

  const consent = await readAiConsentForProfile(actor.accessTier, async () => client);
  if (consent.status === "unavailable") return { ok: false, reason: "error" };
  if (consent.status !== "ready" || aiConsentState(consent.consent) !== "granted") return { ok: false, reason: "consent" };

  const apiKey = readEviApiKey(dependencies.env ?? process.env);
  if (apiKey === null) return { ok: false, reason: "unavailable" };
  if (!takeEviSlot(actor.authUserId)) return { ok: false, reason: "busy" };

  try {
    const [cards, orvis] = await Promise.all([
      (dependencies.readCatalog ?? defaultReadCatalog)(client),
      (dependencies.readOrvis ?? defaultReadOrvis)(client),
    ]);
    const keys = cards.map((card) => card.cardKey);
    const text = await callEviModel({
      apiKey,
      fetch: dependencies.fetch,
      sleep: dependencies.sleep,
      body: eviRequestBody({
        system: eviSystemPrompt(cards, locale),
        messages: [
          { role: "user", content: eviOpening(orvis?.completed ? orvis.profile : null) },
          // Прошлые реплики Эви — в той же форме JSON, что модель должна вернуть: так она не сбивается на простой текст.
          ...turns.map((turn) => (turn.role === "assistant"
            ? { role: turn.role, content: JSON.stringify({ message: turn.content }) }
            : turn)),
        ],
        effort: eviEffort(turns.filter((turn) => turn.role === "user").length),
        schema: eviReplySchema(keys),
      }),
    });
    const reply = parseEviReply(extractJsonObject(text), new Set(keys));
    if (reply === null) return { ok: false, reason: "error" };
    const byKey = new Map(cards.map((card) => [card.cardKey, card]));
    const results = reply.picks?.flatMap((pick) => {
      const card = byKey.get(pick.cardKey);
      if (!card) return [];
      const ky = locale === "ky";
      return [{
        cardId: card.cardId,
        cardKey: card.cardKey,
        title: ky ? card.body.title_ky : card.body.title_ru,
        summary: (ky ? card.body.summary_ky : card.body.summary_ru) ?? null,
        why: pick.why,
      }];
    }) ?? null;
    return {
      ok: true,
      answer: { message: reply.message, mood: reply.mood, options: reply.options, multi: reply.multi, results, progress: reply.progress },
    };
  } catch (error) {
    // Отказ модели — переписку не спасти повтором: «Разговор сбился. Начните новый чат.». Ключ отозван или лимит
    // трат исчерпан — честное «Эви сейчас недоступен» с каталогом.
    const code = error instanceof EviModelError ? error.code : "failed";
    const reason = code === "rate_limited" ? "busy" : code === "refused" ? "invalid" : code === "unavailable" ? "unavailable" : "error";
    return { ok: false, reason };
  }
}
