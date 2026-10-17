import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Потоковый прокси записей разговоров Beeline KG: запрос к источнику и ответ браузеру
 * («Телефония Beeline KG», срез T6; docs/EVO_TELEPHONY_PLAN_2026-10-16.md §7.2, §7.3;
 * ADR 0033, решение 3: копий записей нет).
 *
 * Модуль ничего не знает о сессии, правах и базе: ему дают ссылку, которую уже
 * выдала база, и он отвечает, что делать с ответом источника. Правила:
 *  - ссылка проверяется строго до запроса (`parseRecordingLink`): `https`, хост ровно
 *    равен хосту тенанта из env, без порта, без учётных данных, без query и якоря,
 *    путь из безопасных сегментов и оканчивается на `.mp3`, адрес хоста не
 *    частный (защита от подмены ссылки через украденный токен, SSRF);
 *  - запрос: `GET`, без cookie и заголовков сотрудника (только `Range` одиночного
 *    `bytes=…`, `Accept`, `Accept-Encoding: identity`), `redirect: "manual"`,
 *    `cache: "no-store"`; заголовки источника ждём 10 с, простой тела — 15 с; отмена
 *    клиента отменяет запрос к источнику;
 *  - ответ: тип источника ровно `audio/mpeg`, иначе отказ без тела; тело передаётся
 *    потоком без буферизации, не больше 16 МиБ; источник, игнорирующий `Range`
 *    (200 на запрос диапазона), читается в память запроса целиком (в тех же 16 МиБ)
 *    и отдаётся срезом; заголовки ответа — только из белого списка;
 *  - ничего не сохраняется ни на диск, ни в кэш, ни в журнал: ссылка, адрес и тело не
 *    попадают в ошибки и в `message`; результат — слово причины.
 */

export const RECORDING_MAX_BYTES = 16 * 1024 * 1024;
export const RECORDING_HEADERS_TIMEOUT_MS = 10_000;
export const RECORDING_IDLE_TIMEOUT_MS = 15_000;
const MAX_LINK_LENGTH = 1_024;

// Безопасные сегменты пути: буквы, цифры, `_ ~ -` в начале, точки только внутри
// (ни `.`, ни `..`, ни скрытых файлов); до восьми сегментов; имя файла — `.mp3`.
// Настоящую форму ссылок Beeline уточняет приёмка (план §15, строка про запись):
// пока шаблон строже, чем нужно, лишнее отвергается, а не пропускается.
const LINK_PATH = /^\/(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/){0,7}[A-Za-z0-9_~-][A-Za-z0-9._~-]*\.mp3$/iu;

/** Ссылка из базы → адрес для запроса или null. Ничего, кроме строгой формы, не проходит. */
export function parseRecordingLink(link: unknown, recordingHost: string): URL | null {
  if (typeof link !== "string" || link.length === 0 || link.length > MAX_LINK_LENGTH) return null;
  if (link.includes("?") || link.includes("#") || link.includes("\\") || /[\s\u0000-\u001f\u007f]/u.test(link)) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  // Хост ровно равен настроенному; адресный литерал не принимается ни при каком хосте.
  if (url.hostname !== recordingHost || isIP(url.hostname) !== 0 || url.hostname.startsWith("[")) return null;
  // Каноническая запись: что хранится, то и вызывается (без `%`-кодировок, регистра хоста, точек).
  if (!LINK_PATH.test(url.pathname) || url.href !== link) return null;
  return url;
}

// ---------------------------------------------------------------------------
// Частные и служебные адреса (SSRF).
// ---------------------------------------------------------------------------

const RESERVED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  RESERVED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  RESERVED.addSubnet(network, prefix, "ipv6");
}

/** Адрес из глобальной сети: не частный, не петлевой, не служебный, не групповой. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // IPv4-отображённые IPv6-адреса (`::ffff:10.0.0.1`) проверяются как IPv4 самим BlockList.
  return !RESERVED.check(address, family === 4 ? "ipv4" : "ipv6");
}

// ---------------------------------------------------------------------------
// Range.
// ---------------------------------------------------------------------------

export type RecordingRange = Readonly<{
  /** Каноническая запись для источника: `bytes=0-`, `bytes=10-20`, `bytes=-500`. */
  header: string;
  start: number | null;
  end: number | null;
  suffix: number | null;
}>;

/**
 * Одиночный `bytes=…` → диапазон; всё остальное (несколько диапазонов, другая единица,
 * `bytes=5-2`, пустой диапазон, нечисла) — null: заголовок игнорируется и отдаётся вся
 * запись (RFC 9110 §14.2 разрешает игнорировать `Range`).
 */
export function parseSingleRange(header: string | null): RecordingRange | null {
  if (header === null) return null;
  const match = /^bytes=(\d{1,15})?-(\d{1,15})?$/u.exec(header.trim());
  if (match === null) return null;
  const [, first, last] = match;
  if (first === undefined && last === undefined) return null;
  if (first === undefined) {
    const suffix = Number(last);
    return suffix === 0 ? null : Object.freeze({ header: `bytes=-${suffix}`, start: null, end: null, suffix });
  }
  const start = Number(first);
  if (last === undefined) return Object.freeze({ header: `bytes=${start}-`, start, end: null, suffix: null });
  const end = Number(last);
  return end < start ? null : Object.freeze({ header: `bytes=${start}-${end}`, start, end, suffix: null });
}

/** Какой срез записи длиной `total` просит диапазон; `unsatisfiable` — за пределами. */
export function sliceFor(range: RecordingRange, total: number): Readonly<{ start: number; end: number }> | "unsatisfiable" {
  if (total <= 0) return "unsatisfiable";
  if (range.suffix !== null) return { start: Math.max(0, total - range.suffix), end: total - 1 };
  const start = range.start ?? 0;
  if (start >= total) return "unsatisfiable";
  return { start, end: Math.min(range.end ?? total - 1, total - 1) };
}

const CONTENT_RANGE = /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15}|\*)$/u;
const CONTENT_RANGE_UNSATISFIED = /^bytes \*\/(\d{1,15})$/u;

// ---------------------------------------------------------------------------
// Запрос к источнику.
// ---------------------------------------------------------------------------

export type RecordingFailureReason =
  | "address"
  | "timeout"
  | "network"
  | "redirect"
  | "status"
  | "content_type"
  | "encoding"
  | "too_large"
  | "bad_range"
  | "aborted";

export type RecordingOutcome =
  | Readonly<{ kind: "stream"; response: Response }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "failed"; reason: RecordingFailureReason }>;

export type RecordingFetchDependencies = Readonly<{
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  resolveHost?: (host: string) => Promise<readonly Readonly<{ address: string; family: number }>[]>;
  headersTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxBytes?: number;
}>;

class RecordingStreamError extends Error {
  readonly reason: RecordingFailureReason;
  constructor(reason: RecordingFailureReason) {
    super(reason);
    this.name = "RecordingStreamError";
    this.reason = reason;
  }
}

/** Заголовки ответа браузеру: только белый список; `extra` — длина и диапазон. */
function playbackHeaders(extra: Readonly<Record<string, string>> = {}): Headers {
  const headers = new Headers({
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, no-transform",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Disposition": "inline",
  });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function mediaType(headers: Headers): string {
  return (headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function safeInteger(value: string | null): number | null {
  return value !== null && /^\d{1,15}$/u.test(value.trim()) ? Number(value.trim()) : null;
}

/**
 * Тело источника → поток браузеру без буферизации: считает байты (не больше предела),
 * ждёт не дольше «простоя» между порциями, отменяет запрос к источнику при ошибке и при
 * отмене клиентом. Ошибка потока обрывает ответ (заголовки уже ушли).
 */
function guardedStream(
  body: ReadableStream<Uint8Array>,
  limits: Readonly<{ maxBytes: number; idleMs: number; abortUpstream: () => void }>,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new RecordingStreamError("timeout")), limits.idleMs);
          }),
        ]);
        if (result.done) {
          controller.close();
          return;
        }
        total += result.value.byteLength;
        if (total > limits.maxBytes) throw new RecordingStreamError("too_large");
        controller.enqueue(result.value);
      } catch (error) {
        limits.abortUpstream();
        controller.error(error instanceof RecordingStreamError ? error : new RecordingStreamError("network"));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    cancel() {
      limits.abortUpstream();
      return reader.cancel().catch(() => undefined);
    },
  });
}

/** Вся запись в память запроса (источник проигнорировал `Range`), не больше предела. */
async function readWhole(
  body: ReadableStream<Uint8Array> | null,
  limits: Readonly<{ maxBytes: number; idleMs: number; abortUpstream: () => void }>,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RecordingStreamError("timeout")), limits.idleMs);
        }),
      ]);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limits.maxBytes) throw new RecordingStreamError("too_large");
      chunks.push(result.value);
    } catch (error) {
      limits.abortUpstream();
      await reader.cancel().catch(() => undefined);
      throw error instanceof RecordingStreamError ? error : new RecordingStreamError("network");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

const defaultResolveHost: NonNullable<RecordingFetchDependencies["resolveHost"]> = (host) =>
  lookup(host, { all: true, verbatim: true });

/**
 * Запрашивает запись у источника и превращает ответ в итог: поток для браузера, «404/410»
 * (решение о сроке принимает база по возрасту звонка) или отказ со словом причины.
 */
export async function fetchRecording(
  url: URL,
  range: RecordingRange | null,
  clientSignal: AbortSignal,
  dependencies: RecordingFetchDependencies = {},
): Promise<RecordingOutcome> {
  const fetchImplementation = dependencies.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  const headersTimeoutMs = dependencies.headersTimeoutMs ?? RECORDING_HEADERS_TIMEOUT_MS;
  const idleMs = dependencies.idleTimeoutMs ?? RECORDING_IDLE_TIMEOUT_MS;
  const maxBytes = dependencies.maxBytes ?? RECORDING_MAX_BYTES;

  if (clientSignal.aborted) return { kind: "failed", reason: "aborted" };

  // Адрес хоста — глобальный: ссылка с хостом тенанта не должна вести в частную сеть.
  try {
    const addresses = await resolveHost(url.hostname);
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return { kind: "failed", reason: "address" };
    }
  } catch {
    return { kind: "failed", reason: "network" };
  }

  // Пока определялся адрес, клиент мог уйти: слушатель отмены ставится на уже отменённый сигнал вхолостую.
  if (clientSignal.aborted) return { kind: "failed", reason: "aborted" };

  const controller = new AbortController();
  let timedOut = false;
  const abortUpstream = () => controller.abort();
  const onClientAbort = () => controller.abort();
  clientSignal.addEventListener("abort", onClientAbort, { once: true });
  const headersTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, headersTimeoutMs);

  let response: Response;
  try {
    response = await fetchImplementation(url.toString(), {
      method: "GET",
      // Без cookie и заголовков сотрудника: источнику уходит только диапазон.
      headers: {
        Accept: "audio/mpeg, */*;q=0.1",
        "Accept-Encoding": "identity",
        ...(range === null ? {} : { Range: range.header }),
      },
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  } catch {
    clientSignal.removeEventListener("abort", onClientAbort);
    return { kind: "failed", reason: timedOut ? "timeout" : clientSignal.aborted ? "aborted" : "network" };
  } finally {
    clearTimeout(headersTimer);
  }

  const cleanup = () => clientSignal.removeEventListener("abort", onClientAbort);
  const discard = async () => {
    cleanup();
    await response.body?.cancel().catch(() => undefined);
  };

  if (response.status >= 300 && response.status < 400) {
    await discard();
    return { kind: "failed", reason: "redirect" };
  }
  if (response.status === 404 || response.status === 410) {
    await discard();
    return { kind: "not_found" };
  }
  if (response.status === 416 && range !== null) {
    const unsatisfied = CONTENT_RANGE_UNSATISFIED.exec(response.headers.get("content-range") ?? "");
    await discard();
    if (unsatisfied === null) return { kind: "failed", reason: "bad_range" };
    return {
      kind: "stream",
      response: new Response(null, { status: 416, headers: playbackHeaders({ "Content-Range": `bytes */${unsatisfied[1]}` }) }),
    };
  }
  if (response.status !== 200 && response.status !== 206) {
    await discard();
    return { kind: "failed", reason: "status" };
  }
  if (mediaType(response.headers) !== "audio/mpeg") {
    await discard();
    return { kind: "failed", reason: "content_type" };
  }
  const encoding = (response.headers.get("content-encoding") ?? "").trim().toLowerCase();
  if (encoding !== "" && encoding !== "identity") {
    await discard();
    return { kind: "failed", reason: "encoding" };
  }

  const declaredLength = safeInteger(response.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > maxBytes) {
    await discard();
    return { kind: "failed", reason: "too_large" };
  }

  const limits = { maxBytes, idleMs, abortUpstream };

  if (response.status === 206) {
    // Частичный ответ допустим только на запрос диапазона и только с честным Content-Range.
    const parsed = CONTENT_RANGE.exec(response.headers.get("content-range") ?? "");
    const first = parsed === null ? null : Number(parsed[1]);
    const last = parsed === null ? null : Number(parsed[2]);
    const total = parsed === null || parsed[3] === "*" ? null : Number(parsed[3]);
    if (
      range === null ||
      parsed === null ||
      first === null ||
      last === null ||
      last < first ||
      (total !== null && (last >= total || total > maxBytes)) ||
      last - first + 1 > maxBytes ||
      (declaredLength !== null && declaredLength !== last - first + 1)
    ) {
      await discard();
      return { kind: "failed", reason: "bad_range" };
    }
    if (response.body === null) {
      cleanup();
      return { kind: "failed", reason: "network" };
    }
    const headers = playbackHeaders({
      "Content-Range": `bytes ${first}-${last}/${total ?? "*"}`,
      "Content-Length": String(last - first + 1),
    });
    return {
      kind: "stream",
      response: new Response(guardedStream(response.body, limits), { status: 206, headers }),
    };
  }

  // 200.
  if (range !== null) {
    // Источник проигнорировал диапазон: запись целиком в память запроса и срез по просьбе.
    let whole: Uint8Array;
    try {
      whole = await readWhole(response.body, limits);
    } catch (error) {
      cleanup();
      return { kind: "failed", reason: error instanceof RecordingStreamError ? error.reason : "network" };
    }
    cleanup();
    const slice = sliceFor(range, whole.byteLength);
    if (slice === "unsatisfiable") {
      return {
        kind: "stream",
        response: new Response(null, { status: 416, headers: playbackHeaders({ "Content-Range": `bytes */${whole.byteLength}` }) }),
      };
    }
    const part = whole.subarray(slice.start, slice.end + 1);
    return {
      kind: "stream",
      response: new Response(part as BodyInit, {
        status: 206,
        headers: playbackHeaders({
          "Content-Range": `bytes ${slice.start}-${slice.end}/${whole.byteLength}`,
          "Content-Length": String(part.byteLength),
        }),
      }),
    };
  }
  if (response.body === null) {
    cleanup();
    return { kind: "failed", reason: "network" };
  }
  const headers = playbackHeaders(declaredLength === null ? {} : { "Content-Length": String(declaredLength) });
  return {
    kind: "stream",
    response: new Response(guardedStream(response.body, limits), { status: 200, headers }),
  };
}
