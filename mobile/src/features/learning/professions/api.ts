// Профессии (карточки O*NET, миграции 198/199): список и карточка. Парсеры общие с вебом.
import type { ProfessionProgramRow } from "@web/lib/portal/profession-guide";
import { parseProfessionCard, parseProfessionCards, type ProfessionCard, type ProfessionCardSummary, type ProfessionLinkedProgramRef } from "@web/lib/portal/professions";
import type { IndexUniversity, StudentUniversityDetail } from "@web/lib/portal/university-index";

import { PortalDecodeError } from "@/domain/portal-source";
import { readUniversityDetail, UniversityNotFoundError } from "@/features/universities/api";
import { institutionIdsForRefs, resolveProgramRows } from "@/features/learning/professions/model";
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

/**
 * «Где учиться в EVO»: те же чтения, что у веба (`readProfessionPrograms`): страница каждого вуза-связи читается
 * одним вызовом, все параллельно. Вуз, снятый с публикации между чтениями, - строка без ссылки; любой другой сбой
 * поднимается наверх (экран оставит направления текстом, как веб).
 */
export async function loadProfessionPrograms(
  transport: RpcTransport,
  refs: readonly ProfessionLinkedProgramRef[],
  universities: readonly IndexUniversity[],
  now: Date,
): Promise<ProfessionProgramRow[]> {
  if (refs.length === 0) return [];
  const ids = institutionIdsForRefs(refs, universities);
  const details = (
    await Promise.all(
      ids.map((id) =>
        readUniversityDetail(transport, id).then(
          (detail): StudentUniversityDetail | null => detail,
          (error: unknown) => {
            if (error instanceof UniversityNotFoundError) return null;
            throw error;
          },
        ),
      ),
    )
  ).filter((detail): detail is StudentUniversityDetail => detail !== null);
  return resolveProgramRows(refs, details, now);
}
