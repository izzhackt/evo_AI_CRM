// Профессии (карточки O*NET, миграции 198/199): список и карточка. Парсеры общие с вебом.
import { parseProfessionCard, parseProfessionCards, type ProfessionCard, type ProfessionCardSummary } from "@web/lib/portal/professions";

import { PortalDecodeError } from "@/domain/portal-source";
import { rpcRead, type RpcTransport } from "@/lib/rpc";

function decoded<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch {
    throw new PortalDecodeError();
  }
}

export const readProfessionCards = async (t: RpcTransport): Promise<ProfessionCardSummary[]> => decoded(parseProfessionCards, await rpcRead(t, "profession_cards_v1", {}));
export const readProfessionCard = async (t: RpcTransport, cardId: string): Promise<ProfessionCard> => decoded(parseProfessionCard, await rpcRead(t, "profession_card_v1", { p_card_id: cardId }));
