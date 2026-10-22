import "server-only";

import type { AiAgentEventKind } from "../../ai-agents/contract.ts";

/*
 * ЗАГЛУШКА АРХИТЕКТОРА (контракт §C.4): файл принадлежит строителю C. Хуки
 * приёма заявки сайта и входящего WhatsApp зовут её через `after()` и никогда
 * не ждут: функция не бросает и сама глотает любую ошибку.
 */

export async function dispatchAiAgentEvent(
  _event: Readonly<{ kind: AiAgentEventKind; ref: string | null }>,
): Promise<Readonly<{ started: number }>> {
  return { started: 0 };
}
