import "server-only";

import { readProfessionCard, readProfessionCards } from "../../portal/professions-source";
import type { ProfessionCard } from "../../portal/professions";

let cached: Readonly<{ key: string; cards: readonly ProfessionCard[] }> | null = null;

/**
 * Опубликованные карточки «Профессий» целиком — для досье Эви. Список карточек (одна выдача) сверяется по ключам и
 * версиям; полные карточки перечитываются, только когда он изменился. Каталог общий для всех учеников, личного в нём
 * нет, поэтому его можно держать в памяти процесса.
 */
export async function readEviCatalog(): Promise<readonly ProfessionCard[]> {
  const summaries = await readProfessionCards();
  const key = summaries.map((card) => `${card.cardKey}@${card.version}`).sort().join(",");
  if (cached?.key === key) return cached.cards;
  const cards = await Promise.all(summaries.map((card) => readProfessionCard(card.cardId)));
  cached = { key, cards };
  return cards;
}
