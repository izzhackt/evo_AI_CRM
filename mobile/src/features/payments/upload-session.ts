// Токены отправки чека, привязанные к студенту, который её начал (ревью #1560, L-A).
//
// Отправка не обрывается, когда закрывается слот или экран (M1), поэтому она может пережить выход студента. А замыкания
// `getAccessToken` и `refreshAccessToken` кабинета (`(app)/_layout.tsx`) читают единственный клиент Supabase на устройстве, то есть
// ту сессию, которая «живая» сейчас, а не сессию студента, начавшего отправку. Если первый ответ на чек студента А пришёл как 401
// уже после того, как А вышел и вошёл Б, `sendWithRefresh` обновил бы сессию Б и отправил файл и сумму А с токеном Б. У чека к платежу
// сервер сверяет владельца платежа и отказал бы, но «Добавить платёж» платёж не называет: чужой файл стал бы чеком без платежа
// в кабинете Б.
//
// Привязка: токен выдаётся и обновляется, только пока на устройстве вошёл тот же студент (auth user id), что начал отправку.
// Иначе - как без сессии: 401, «Войдите снова» (`receiptErrorSession`), ничего больше не уходит. Любой сбой проверки - тоже отказ.
import type { PortalApi } from "@/api/PortalApi";

export type OwnerBoundTokens = Readonly<{
  /** Токен для запроса; `null` - сессии нет или она уже чужая. */
  getToken: () => Promise<string | null>;
  /** Обновить сессию на 401; `null` - обновлять нельзя (сессия чужая) или не вышло. */
  refreshToken: () => Promise<string | null>;
}>;

/**
 * `api.userKey` - студент, который начинает отправку; `liveUserId` - кто вошёл на устройстве сейчас (`PaymentsIo.liveUserId`).
 * Проверка идёт до обращения к сессии и ещё раз после обновления: сеть могла ответить уже после смены студента, и такой токен
 * отбрасывается.
 */
export function ownerBoundTokens(api: Pick<PortalApi, "userKey" | "getAccessToken" | "refreshAccessToken">, liveUserId: () => Promise<string | null>): OwnerBoundTokens {
  const owner = api.userKey;
  const ownerIsSignedIn = async (): Promise<boolean> => {
    try {
      return (await liveUserId()) === owner;
    } catch {
      return false;
    }
  };
  const bound = (read: () => Promise<string | null>) => async (): Promise<string | null> => {
    if (!(await ownerIsSignedIn())) return null;
    const token = await read();
    return token !== null && (await ownerIsSignedIn()) ? token : null;
  };
  return { getToken: bound(() => api.getAccessToken()), refreshToken: bound(() => api.refreshAccessToken()) };
}
