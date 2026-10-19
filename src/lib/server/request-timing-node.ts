import http from "node:http";

import {
  beginRpc,
  buildTimingRecord,
  countOtherSupabaseCall,
  endRpc,
  matchedRouteOf,
  releaseLabel,
  serverTimingHeader,
  startRequestTiming,
  timingStorage,
  type RequestTiming,
  type TimingRecord,
} from "../request-timing.ts";

/**
 * Подключение замера A0 к Node.js-процессу (вызывает `src/instrumentation.ts`
 * один раз при старте сервера). Два перехвата, оба снаружи кода продукта:
 *
 * 1. `http.Server.prototype.emit("request")` открывает контекст
 *    AsyncLocalStorage на весь запрос (proxy, рендер, route handler, server
 *    action) и пишет одну строку, когда ответ закрыт. Здесь видны сырые
 *    заголовки запроса (`next-action`, `next-router-prefetch`, `rsc`), которых
 *    proxy уже не видит.
 * 2. `globalThis.fetch` снизу стека (под патчем Next): вызовы PostgREST
 *    `/rest/v1/rpc/*` и остальные обращения к origin Supabase считаются в
 *    контексте запроса.
 *
 * Вне запроса (нет контекста) обёртка fetch сразу передаёт вызов дальше.
 * Любой сбой замера проглатывается: он не должен менять ответ пользователю.
 */

const INSTALLED_SYMBOL = Symbol.for("evo.request-timing.installed.v1");
const RPC_PATH = "/rest/v1/rpc/";

type InstallHolder = { [INSTALLED_SYMBOL]?: () => void };
type EmitFunction = (this: http.Server, event: string | symbol, ...args: unknown[]) => boolean;
type WriteHead = (this: http.ServerResponse, ...args: unknown[]) => http.ServerResponse;

export type RequestTimingSink = (record: TimingRecord) => void;

export type InstallOptions = Readonly<{
  /** Куда писать запись; по умолчанию — строка JSON в stdout. */
  sink?: RequestTimingSink;
  environment?: Readonly<Record<string, string | undefined>>;
}>;

function defaultSink(record: TimingRecord): void {
  console.info(JSON.stringify(record));
}

function supabaseOrigin(environment: Readonly<Record<string, string | undefined>>): string | null {
  try {
    const raw = environment["NEXT_PUBLIC_SUPABASE_URL"];
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const request = input as { url?: unknown } | null;
  return typeof request?.url === "string" ? request.url : "";
}

function instrumentResponse(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  timing: RequestTiming,
  options: Readonly<{ sink: RequestTimingSink; release: () => string; environment: Readonly<Record<string, string | undefined>> }>,
): void {
  const typed = response as unknown as { writeHead: WriteHead };
  const writeHead = typed.writeHead;
  typed.writeHead = function patchedWriteHead(this: http.ServerResponse, ...args: unknown[]) {
    try {
      if (timing.ttfbMs === null) {
        timing.ttfbMs = performance.now() - timing.startedAt;
        timing.depthAtHead = timing.depth;
      }
      if (!response.headersSent) {
        const value = serverTimingHeader(timing, options.environment);
        if (value !== null) response.setHeader("Server-Timing", value);
      }
    } catch {
      // Замер не должен ломать ответ.
    }
    return writeHead.apply(this, args);
  };

  response.once("close", () => {
    try {
      timing.finished = true;
      if (!timing.proxied) return;
      const record = buildTimingRecord(
        timing,
        {
          status: response.statusCode,
          aborted: !response.writableFinished,
          route: matchedRouteOf(request),
        },
        options.release(),
      );
      // Клиент оборвал запрос раньше, чем Next выбрал маршрут (уход со страницы
      // отменяет опрос на лету): измерять нечего, а класс `unmatched` и вид
      // `page` только запутали бы отчёт.
      if (record.aborted && record.class === "unmatched" && record.rpc === 0) return;
      options.sink(record);
    } catch {
      // Замер не должен ломать ответ.
    }
  });
}

/**
 * Ставит оба перехвата. Повторный вызов ничего не меняет. Возвращает
 * функцию, которая снимает перехваты (нужна тестам).
 */
export function installRequestTiming(options: InstallOptions = {}): () => void {
  const holder = globalThis as unknown as InstallHolder;
  const already = holder[INSTALLED_SYMBOL];
  if (already) return already;

  const environment = options.environment ?? process.env;
  const sink = options.sink ?? defaultSink;
  let release: string | null = null;
  const releaseOnce = () => (release ??= releaseLabel(environment));
  const storage = timingStorage();

  const originalFetch = globalThis.fetch;
  let origin: string | null | undefined;
  const timedFetch = function evoTimedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const timing = storage.getStore();
    if (!timing || timing.finished) return originalFetch.call(this, input, init);
    let call: ReturnType<typeof beginRpc> = null;
    try {
      const url = urlOf(input);
      if (url.includes(RPC_PATH)) {
        call = beginRpc(timing);
      } else {
        origin ??= supabaseOrigin(environment);
        if (origin !== null && url.startsWith(origin)) countOtherSupabaseCall(timing);
      }
    } catch {
      call = null;
    }
    const pending = originalFetch.call(this, input, init);
    if (call) {
      const finish = () => endRpc(timing, call);
      pending.then(finish, finish);
    }
    return pending;
  } as typeof fetch;
  globalThis.fetch = timedFetch;

  const serverPrototype = http.Server.prototype as unknown as { emit: EmitFunction };
  const originalEmit = serverPrototype.emit;
  const hadOwnEmit = Object.hasOwn(serverPrototype, "emit");
  serverPrototype.emit = function timedEmit(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event !== "request") return originalEmit.call(this, event, ...args);
    let timing: RequestTiming | null = null;
    try {
      const [request, response] = args as [http.IncomingMessage, http.ServerResponse];
      timing = startRequestTiming(request.headers);
      instrumentResponse(request, response, timing, { sink, release: releaseOnce, environment });
    } catch {
      timing = null;
    }
    if (timing === null) return originalEmit.call(this, event, ...args);
    return storage.run(timing, () => originalEmit.call(this, event, ...args));
  } as EmitFunction;

  const uninstall = () => {
    if (globalThis.fetch === timedFetch) globalThis.fetch = originalFetch;
    if (serverPrototype.emit !== originalEmit) {
      if (hadOwnEmit) serverPrototype.emit = originalEmit;
      else delete (serverPrototype as { emit?: EmitFunction }).emit;
    }
    delete holder[INSTALLED_SYMBOL];
  };
  holder[INSTALLED_SYMBOL] = uninstall;
  return uninstall;
}
