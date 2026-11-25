// Проверка свободных портов стенда preview (используется scripts/ci/pr-preview.mjs; поведение стережёт tests/pr-preview-ports.test.mjs).
// Порты стенда 46440-46451 лежат внутри эфемерного диапазона Linux (32768-60999): исходящее соединение самого раннера
// (docker pull, apt, npm, агент) на мгновения может занять один из них, и разовая проверка роняла прогон на ровном месте.
// Поэтому проверка повторяется целиком, все порты заново: до PORT_CHECK_ATTEMPTS попыток с паузой PORT_CHECK_PAUSE_MS
// между ними (6 попыток и 5 пауз по 5 с, около 25 с). Порт, занятый по-настоящему, по-прежнему останавливает прогон тем же
// сообщением PORT_BUSY, только уже после последней попытки. Сами порты и то, что доказывает preview, не меняются.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export const PORT_CHECK_ATTEMPTS = 6;
export const PORT_CHECK_PAUSE_MS = 5000;

export const portFree = (port, host) => new Promise((ok) => {
  const server = createServer();
  server.once("error", () => ok(false));
  server.listen(port, host, () => server.close(() => ok(true)));
});

/**
 * Все порты из `ports` ({ имя: порт }) свободны. Первый занятый порт (по порядку `ports`) обрывает попытку;
 * следующая попытка проверяет всё заново. После `attempts`-й неудачной попытки бросает AssertionError
 * `PORT_BUSY <имя>:<порт> занят чужим процессом` (порт из последней попытки). `isFree`, `sleep` и `log` подменяются в тестах.
 */
export async function assertPortsFree(ports, {
  host = "0.0.0.0", attempts = PORT_CHECK_ATTEMPTS, pauseMs = PORT_CHECK_PAUSE_MS,
  isFree = portFree, sleep = delay, log = () => {},
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
    if (attempt >= attempts) assert.fail(`PORT_BUSY ${busy.name}:${busy.port} занят чужим процессом`);
    log(`порт ${busy.name}:${busy.port} занят, попытка ${attempt}/${attempts}, повтор через ${pauseMs / 1000} с`);
    await sleep(pauseMs);
  }
}
