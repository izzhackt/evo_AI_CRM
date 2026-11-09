// Удаление аккаунта из приложения (миграция 280/346, Apple 5.1.1(v)). Тот же поток, что на вебе
// (AccountDeletionPanel) и в iPhone (AccountDeletionSheet): статус своего запроса читается с сервера
// (`own_account_deletion_request_v1`), запрос уходит как `request_account_deletion_v2` с замороженным
// `p_request_id` на попытку. Запрос не удаляет аккаунт сразу: срок обработки 30 дней, пока он работает как обычно.
import { parseOwnAccountDeletion, type OwnAccountDeletion } from "@web/lib/account-deletion-contract";

import { createWrite, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

export class AccountDeletionDecodeError extends Error {
  constructor() {
    super("account-deletion:decode");
    this.name = "AccountDeletionDecodeError";
  }
}

/** Статус своего запроса; `null`: запроса нет. Чужая форма ответа — ошибка, а не «нет запроса». */
export async function readOwnAccountDeletion(transport: RpcTransport): Promise<OwnAccountDeletion | null> {
  const request = parseOwnAccountDeletion(await rpcRead(transport, "own_account_deletion_request_v1"));
  if (request === undefined) throw new AccountDeletionDecodeError();
  return request;
}

/** Запись на попытку: повтор после сбоя сети шлёт тот же запрос с тем же id. */
export function accountDeletionWrite(): FrozenWrite {
  return createWrite("request_account_deletion_v2", {});
}

export async function requestAccountDeletion(transport: RpcTransport, write: FrozenWrite): Promise<OwnAccountDeletion> {
  const request = parseOwnAccountDeletion(await rpcWrite(transport, write));
  // Ответ обязан быть открытым запросом: пустой ответ не квитанция.
  if (!request) throw new AccountDeletionDecodeError();
  return request;
}
