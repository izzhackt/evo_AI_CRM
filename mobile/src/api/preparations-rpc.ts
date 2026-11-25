// Вызов RPC программ (требования, документы, комплекты) прямо через транспорт.
//
// Зачем не `rpcWrite` из `lib/rpc.ts`. Записи этого раздела различают отказы по ТЕКСТУ ошибки сервера
// (`application_requirements_*`, `application_document_*`, `application_package_*`: общие разборщики веба
// `applicationRequirementsFailure`, `applicationDocumentFailure`, `applicationPackageFailure`), а `lib/rpc.ts` текст
// отбрасывает и оставляет коду только вид отказа. Подгонять `lib/rpc.ts` под этот раздел не нужно: файлом владеет
// другой срез, а здесь достаточно тонкого слоя.
//
// Инвариант 3 из `lib/rpc.ts` сохранён: текст сервера нужен ровно для одного - найти причину в закрытом списке
// общего разборщика. Наружу выходит только эта причина; текст не пишется в журнал, не показывается на экране и не хранится.
import { classifyRpcFailure, type RpcTransport } from "@/lib/rpc";

/** Сбой ответа: код и текст сервера только для сопоставления с закрытым списком причин, дальше разборщика они не идут. */
export type RpcFailure = Readonly<{ code: string | null; message: string | null; status: number | null }>;

export type RpcOutcome =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{
      ok: false;
      failure: RpcFailure;
      /** Ответа нет: обрыв, таймаут, нет сети. Запись могла дойти до сервера, результат неизвестен. */
      transport: boolean;
    }>;

export type CallOptions = Readonly<{
  /** Сколько раз повторить ТОТ ЖЕ запрос при обрыве и шлюзовых 502/503/504; записи идемпотентны по `p_request_id`. */
  retries?: number;
  /** Пауза перед повтором (номер попытки с нуля). Не задана: 250 мс, 500 мс, затем 1 с. */
  wait?: (attempt: number) => Promise<void>;
}>;

const GATEWAY = new Set([502, 503, 504]);

/**
 * Пауза перед повтором того же запроса, если вызывающий не задал свою: 250 мс, затем 500 мс, дальше 1 с. Без паузы три
 * попытки уходят подряд за доли секунды и бьют в ту же обрывающуюся связь (`rpcWrite` из `lib/rpc.ts` ждёт только то, что ему
 * передали, поэтому пауза нужна здесь).
 */
const BACKOFF_MS = [250, 500, 1000] as const;
const defaultWait = (attempt: number) => new Promise<void>((resolve) => setTimeout(resolve, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]));

function once(transport: RpcTransport, name: string, args: Readonly<Record<string, unknown>>): Promise<RpcOutcome> {
  return Promise.resolve()
    .then(() => transport(name, args, { get: false }))
    .then<RpcOutcome, RpcOutcome>(
      (result) => {
        if (!result.error) return { ok: true, data: result.data };
        const code = result.error.code ? result.error.code : null;
        const message = typeof result.error.message === "string" ? result.error.message : null;
        const status = typeof result.status === "number" ? result.status : null;
        return { ok: false, failure: { code, message, status }, transport: classifyRpcFailure(code, status).kind === "transport" };
      },
      // Транспорт бросил: ответа нет.
      () => ({ ok: false, failure: { code: null, message: null, status: null }, transport: true }),
    );
}

/** Запись или чтение методом POST. Не бросает: итог всегда `RpcOutcome`. */
export async function callRpc(
  transport: RpcTransport,
  name: string,
  args: Readonly<Record<string, unknown>>,
  options: CallOptions = {},
): Promise<RpcOutcome> {
  const retries = options.retries ?? 0;
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await once(transport, name, args);
    if (outcome.ok) return outcome;
    const retryable = outcome.transport || (outcome.failure.status !== null && GATEWAY.has(outcome.failure.status));
    if (!retryable || attempt >= retries) return outcome;
    await (options.wait ?? defaultWait)(attempt);
  }
}

/** Для общих разборщиков веба: `{ code?, message? }` из сбоя ответа. */
export function failureForParser(failure: RpcFailure): Readonly<{ code?: string; message?: string }> {
  return { ...(failure.code !== null ? { code: failure.code } : {}), ...(failure.message !== null ? { message: failure.message } : {}) };
}
