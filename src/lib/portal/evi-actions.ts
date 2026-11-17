"use server";

import { getLocale } from "../i18n";
import { readEviCatalog } from "../server/evi/catalog";
import { takeEviSlot } from "../server/evi/limiter";
import { callEviModel, eviEffort, EviModelError, eviRequestBody, readEviApiKey } from "../server/evi/messages";
import { eviOpening, eviReplySchema, eviSystemPrompt } from "../server/evi/prompt";
import { requireStudentPortalActor } from "../student-portal-guards";
import { aiConsentState } from "./ai-consent.ts";
import { readOwnAiConsentForProfile } from "./ai-consent-source";
import {
  extractJsonObject,
  historyTooLong,
  parseEviHistory,
  parseEviReply,
  type EviActionResult,
} from "./evi.ts";
import { readOwnOrvisState } from "./professions-source";

/**
 * Следующая реплика Эви (вкладка «Подбор с Эви» в «Профессиях»). Порядок проверок — до любого вызова модели:
 * ученик кабинета (сессия), форма и длина истории, согласие на ИИ-помощников (читается заново: страница не проверяет
 * это за действие), ключ Эви в окружении, частота вызовов. В модель уходят только переписка, которую ученик видит на
 * экране, и результат его собственного теста интересов словами (решение владельца 17.11.2026); дело, документы и
 * профиль — нет. Ничего не сохраняется: разговор живёт, пока открыт кабинет.
 */
export async function askEviAction(history: unknown): Promise<EviActionResult> {
  const actor = await requireStudentPortalActor();
  if (historyTooLong(history)) return { ok: false, reason: "limit" };
  const turns = parseEviHistory(history);
  if (turns === null) return { ok: false, reason: "invalid" };

  const consent = await readOwnAiConsentForProfile(actor.accessTier);
  if (consent.status === "unavailable") return { ok: false, reason: "error" };
  if (consent.status !== "ready" || aiConsentState(consent.consent) !== "granted") return { ok: false, reason: "consent" };

  const apiKey = readEviApiKey(process.env);
  if (apiKey === null) return { ok: false, reason: "unavailable" };
  if (!takeEviSlot(actor.authUserId)) return { ok: false, reason: "busy" };

  try {
    const [cards, orvis, locale] = await Promise.all([readEviCatalog(), readOwnOrvisState(), getLocale()]);
    const keys = cards.map((card) => card.cardKey);
    const text = await callEviModel({
      apiKey,
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
