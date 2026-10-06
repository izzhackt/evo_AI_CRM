import "server-only";

/**
 * Выключатель отправки ночного автоответа (план ИИ-агента §11, правило 11;
 * P4). Отдельный лёгкий модуль: его читают и маршрут отправки, и страница
 * «Автоответчик» («Отправка выключена на сервере»), не подтягивая код отправки.
 */
type Env = Readonly<Record<string, string | undefined>>;

/** Выключатель сервера: ровно `1`. Пусто, `0` и всё прочее — выключено. */
export function aiAutosendSwitchOn(env: Env = process.env): boolean {
  return env.EVO_AI_AGENT_AUTOSEND === "1";
}

/**
 * Секрет отправки: 32–256 печатных знаков и не равен ни секрету вызовов
 * агента, ни секрету брокера — иначе отправка выключена.
 */
export function readAiSendSecret(env: Env = process.env): string | null {
  const secret = (env.EVO_AI_AGENT_SEND_SECRET ?? "").trim();
  if (!/^[\x21-\x7e]{32,256}$/u.test(secret)) return null;
  for (const other of [env.EVO_AI_AGENT_INTERNAL_SECRET, env.EVO_AI_AGENT_STORAGE_SECRET]) {
    if (secret === (other ?? "").trim()) return null;
  }
  return secret;
}

/** Состояние выключателя для экрана: `on` только когда маршрут действительно примет отправку. */
export function aiAutosendServerState(env: Env = process.env): "on" | "off" {
  return aiAutosendSwitchOn(env) && readAiSendSecret(env) !== null ? "on" : "off";
}
