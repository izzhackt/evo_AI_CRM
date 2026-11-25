// Проверка свободных портов стенда preview (используется scripts/ci/pr-preview.mjs; поведение стережёт tests/pr-preview-ports.test.mjs).
//
// Блок портов стенда (BASE_PORT в pr-preview.mjs) лежит НИЖЕ эфемерного диапазона Linux (по умолчанию 32768-60999,
// ip_local_port_range). Порты диапазона ядро само выдаёт исходящим соединениям (connect(), сначала чётные), а закрытое
// соединение до 60 с висит в TIME_WAIT и держит порт; bind() на такой порт падает с EADDRINUSE. Пока блок был 46440-46451
// (внутри диапазона), на GitHub-hosted раннере 25.11.2026 упали 4 прогона из 99 (db:46442, pop3:46446, shadow:46440, db:46442),
// и повтор проверки (#1584: 6 попыток по 5 с, около 25 с) не спас ни одного: порт держался дольше. Теперь блок вне диапазона,
// и исходящие соединения раннера занять его не могут. Повтор оставлен второй линией защиты.
// Если порт занят и после последней попытки, перед ошибкой в журнал печатается, чем он занят (pr-preview-port-holders.mjs:
// только состояние, адреса, имя процесса и PID), затем бросается PORT_BUSY с прежним текстом.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export const PORT_CHECK_ATTEMPTS = 6;
export const PORT_CHECK_PAUSE_MS = 5000;
/** Эфемерный диапазон исходящих портов ядра Linux: два числа через пробел или табуляцию, например «32768 60999». */
export const EPHEMERAL_RANGE_FILE = "/proc/sys/net/ipv4/ip_local_port_range";

export const portFree = (port, host) => new Promise((ok) => {
  const server = createServer();
  server.once("error", () => ok(false));
  server.listen(port, host, () => server.close(() => ok(true)));
});

/** Эфемерный диапазон ОС { low, high } или null (не Linux, файла нет, содержимое непонятно). Никогда не бросает. */
export function readEphemeralRange(readText = (path) => readFileSync(path, "utf8")) {
  try {
    const [low, high, ...rest] = String(readText(EPHEMERAL_RANGE_FILE)).trim().split(/\s+/u).map(Number);
    const valid = rest.length === 0 && Number.isInteger(low) && Number.isInteger(high) && low >= 0 && low <= high && high <= 65535;
    return valid ? { low, high } : null;
  } catch { return null; }
}

/** Одна строка для журнала: где лежит блок портов стенда и пересекается ли он с эфемерным диапазоном `range`. */
export function describePortBlock(ports, range) {
  const entries = Object.entries(ports);
  const numbers = entries.map(([, port]) => port);
  const block = `${Math.min(...numbers)}-${Math.max(...numbers)} (${numbers.length} шт.)`;
  if (!range) return `порты стенда ${block}; эфемерный диапазон ОС не определён`;
  const inside = entries.filter(([, port]) => port >= range.low && port <= range.high);
  if (inside.length === 0) {
    return `порты стенда ${block} вне эфемерного диапазона ОС ${range.low}-${range.high}: исходящие соединения раннера их не занимают`;
  }
  const names = inside.map(([name, port]) => `${name}:${port}`).join(", ");
  return `ВНИМАНИЕ: порты стенда ${block} пересекаются с эфемерным диапазоном ОС ${range.low}-${range.high} (${names}): исходящее соединение может занять порт`;
}

/**
 * Итоговая проверка перед ошибкой: какие порты заняты сейчас и чем (`diagnose` получает [{ name, port }] и возвращает строки).
 * Только журнал: любой сбой здесь (в `isFree`, `diagnose`, `log`) не подменяет PORT_BUSY и не бросается наружу.
 */
async function explainBusyPorts(ports, { host, isFree, log, diagnose, attempts }) {
  try {
    const busy = [];
    for (const [name, port] of Object.entries(ports)) {
      if (!(await isFree(port, host))) busy.push({ name, port });
    }
    log(busy.length
      ? `после ${attempts} попыток заняты: ${busy.map(({ name, port }) => `${name}:${port}`).join(", ")}`
      : `после ${attempts} попыток порты освободились к итоговой проверке`);
    for (const line of (await diagnose(busy)) ?? []) log(line);
  } catch (error) {
    try { log(`диагностика занятых портов не удалась: ${String(error?.message ?? error).split("\n")[0].slice(0, 200)}`); } catch { /* журнал недоступен: PORT_BUSY важнее */ }
  }
}

/**
 * Все порты из `ports` ({ имя: порт }) свободны. Первый занятый порт (по порядку `ports`) обрывает попытку;
 * следующая попытка проверяет всё заново. После `attempts`-й неудачной попытки бросает AssertionError
 * `PORT_BUSY <имя>:<порт> занят чужим процессом` (порт из последней попытки); перед этим, если передан `diagnose`,
 * в журнал печатается, какие порты заняты и чем. `isFree`, `sleep`, `log` и `diagnose` подменяются в тестах.
 */
export async function assertPortsFree(ports, {
  host = "0.0.0.0", attempts = PORT_CHECK_ATTEMPTS, pauseMs = PORT_CHECK_PAUSE_MS,
  isFree = portFree, sleep = delay, log = () => {}, diagnose = null,
} = {}) {
  for (let attempt = 1; ; attempt++) {
    let busy = null;
    for (const [name, port] of Object.entries(ports)) {
      if (!(await isFree(port, host))) { busy = { name, port }; break; }
    }
    if (!busy) {
      if (attempt > 1) log(`порты свободны, попытка ${attempt}/${attempts}`);
      return;
    }
    if (attempt >= attempts) {
      if (diagnose) await explainBusyPorts(ports, { host, isFree, log, diagnose, attempts });
      assert.fail(`PORT_BUSY ${busy.name}:${busy.port} занят чужим процессом`);
    }
    log(`порт ${busy.name}:${busy.port} занят, попытка ${attempt}/${attempts}, повтор через ${pauseMs / 1000} с`);
    await sleep(pauseMs);
  }
}
