import { AsyncLocalStorage } from "node:async_hooks";

import { readReleaseMetadata } from "./release-metadata.ts";

/**
 * Замер A0 (docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md §5.1, запись
 * docs/PLAN_CHANGES.md 19.10.2026): одна строка JSON `evo_timing` на запрос
 * страницы, server action или route handler.
 *
 * Здесь только чистая логика: контекст запроса в AsyncLocalStorage, подсчёт
 * RPC и последовательной глубины, выбор вида запроса и класса маршрута, сборка
 * строки. Подключение к `fetch` и к `http.Server` — в
 * `server/request-timing-node.ts` (его ставит `src/instrumentation.ts`).
 *
 * В строку попадают только числа, перечисления и шаблон маршрута Next
 * (`/v3/profile/[caseId]`), никогда сырой путь, query, заголовки, cookie, IP,
 * id пользователя, дела, лида или клиента.
 */

/**
 * `other` — запрос без совпавшего маршрута и без заголовков вида: ответ proxy
 * (редирект, 401/403), файл из `public/`. Он не должен попадать в строки
 * страниц.
 */
export type TimingKind = "page" | "nav" | "prefetch" | "action" | "route" | "other";

type RpcCall = { level: number; startedAt: number };

/** Запрос в работе: всё, что нужно для строки журнала. */
export type RequestTiming = {
  /** `performance.now()` на входе в запрос. */
  readonly startedAt: number;
  /** Unix-время входа, мс (только для `ts`). */
  readonly startedAtEpochMs: number;
  /** Вид по сырым заголовкам запроса; `route`/`page` уточняется по маршруту. */
  readonly headerKind: Exclude<TimingKind, "route" | "page" | "other"> | null;
  /** Запрос прошёл через `src/proxy.ts` (статика и файлы в журнал не идут). */
  proxied: boolean;
  /** Время отправки заголовков ответа, мс от входа. */
  ttfbMs: number | null;
  /** Глубина RPC к моменту отправки заголовков (приёмка S1: «до первого байта»). */
  depthAtHead: number | null;
  rpcCount: number;
  otherCount: number;
  rpcMs: number;
  rpcWallMs: number;
  depth: number;
  /** Уровень последнего закончившегося вызова (для определения глубины). */
  lastFinishedLevel: number;
  inflight: number;
  busySince: number;
  /** Вызовы в полёте: ответ могут оборвать раньше, чем они закончатся. */
  readonly open: Set<RpcCall>;
  finished: boolean;
};

const STORAGE_SYMBOL = Symbol.for("evo.request-timing.v1");

type StorageHolder = { [STORAGE_SYMBOL]?: AsyncLocalStorage<RequestTiming> };

/**
 * Хранилище одно на процесс. Proxy, рендер и instrumentation собираются
 * отдельными бандлами, поэтому общий экземпляр живёт на `globalThis`.
 */
export function timingStorage(): AsyncLocalStorage<RequestTiming> {
  const holder = globalThis as unknown as StorageHolder;
  holder[STORAGE_SYMBOL] ??= new AsyncLocalStorage<RequestTiming>();
  return holder[STORAGE_SYMBOL];
}

/** Текущий запрос или undefined вне запроса (тесты, фоновые задачи). */
export function currentTiming(): RequestTiming | undefined {
  return timingStorage().getStore();
}

/** `src/proxy.ts` зовёт первым делом: запрос — не статика, строка нужна. */
export function markProxied(): void {
  const timing = timingStorage().getStore();
  if (timing) timing.proxied = true;
}

type HeaderReader = Readonly<Record<string, string | string[] | undefined>>;

function present(headers: HeaderReader, name: string): boolean {
  const value = headers[name];
  return Array.isArray(value) ? value.length > 0 : typeof value === "string";
}

function headerIs(headers: HeaderReader, name: string, expected: string): boolean {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) === expected;
}

/**
 * Вид по сырым заголовкам запроса (proxy их уже не видит: Next убирает
 * `rsc` и `next-router-*` до proxy, запись 16.10.2026 «уточнение» п. 1).
 */
export function kindFromHeaders(headers: HeaderReader): RequestTiming["headerKind"] {
  if (present(headers, "next-action")) return "action";
  if (present(headers, "next-router-prefetch") || present(headers, "next-router-segment-prefetch")) {
    return "prefetch";
  }
  if (headerIs(headers, "rsc", "1")) return "nav";
  return null;
}

export function startRequestTiming(
  headers: HeaderReader,
  now: number = performance.now(),
  epochMs: number = Date.now(),
): RequestTiming {
  return {
    startedAt: now,
    startedAtEpochMs: epochMs,
    headerKind: kindFromHeaders(headers),
    proxied: false,
    ttfbMs: null,
    depthAtHead: null,
    rpcCount: 0,
    otherCount: 0,
    rpcMs: 0,
    rpcWallMs: 0,
    depth: 0,
    lastFinishedLevel: 0,
    inflight: 0,
    busySince: 0,
    open: new Set(),
    finished: false,
  };
}

/**
 * Начало вызова PostgREST RPC. Уровень вызова — уровень последнего
 * закончившегося вызова плюс один (определение записи плана A 16.10.2026):
 * вызовы, начатые вместе, лежат на одном уровне, а вызов, начатый после
 * окончания другого, — на следующем. Глубина запроса — наибольший уровень.
 */
export function beginRpc(timing: RequestTiming, now: number = performance.now()): RpcCall | null {
  if (timing.finished) return null;
  const level = timing.lastFinishedLevel + 1;
  timing.rpcCount += 1;
  if (level > timing.depth) timing.depth = level;
  if (timing.inflight === 0) timing.busySince = now;
  timing.inflight += 1;
  const call = { level, startedAt: now };
  timing.open.add(call);
  return call;
}

export function endRpc(timing: RequestTiming, call: RpcCall, now: number = performance.now()): void {
  if (timing.finished) return;
  timing.open.delete(call);
  timing.rpcMs += now - call.startedAt;
  timing.lastFinishedLevel = call.level;
  timing.inflight -= 1;
  if (timing.inflight === 0) timing.rpcWallMs += now - timing.busySince;
}

/** Остальные обращения к Supabase (Auth, Storage, чтение таблиц) — только счётчик. */
export function countOtherSupabaseCall(timing: RequestTiming): void {
  if (!timing.finished) timing.otherCount += 1;
}

const ROUTE_CLASS_PATTERN = /^[A-Za-z0-9_\-.\[\]():*+]+(?:\/[A-Za-z0-9_\-.\[\]():*+]+)*$/u;
const ID_LOOKING = /[0-9a-f]{8}-[0-9a-f]{4}-|\d{5,}/iu;

/**
 * Класс маршрута из шаблона Next (`/portal/universities/[id]`): без
 * ведущего слэша, динамические сегменты остаются как `[id]`. Всё, что не
 * похоже на шаблон или содержит что-либо похожее на идентификатор, — null.
 */
export function routeClassFromTemplate(template: unknown): string | null {
  if (typeof template !== "string") return null;
  const trimmed = template.replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (trimmed.length === 0) return "/";
  if (trimmed.length > 120 || !ROUTE_CLASS_PATTERN.test(trimmed)) return null;
  for (const segment of trimmed.split("/")) {
    // Динамический сегмент — имя параметра в скобках; статический — слово.
    if (!/^\[.*\]$/u.test(segment) && ID_LOOKING.test(segment)) return null;
  }
  return trimmed;
}

export type MatchedRoute = Readonly<{ kind: "APP_PAGE" | "APP_ROUTE" | "OTHER"; template: string }> | null;

const REQUEST_META = Symbol.for("NextInternalRequestMeta");

/**
 * Совпадение маршрута, которое Next кладёт в запрос (`match.definition`).
 * Нет совпадения (ответ proxy, 404) — null. Читается по зарегистрированному
 * символу, внутренние модули Next не импортируются.
 */
export function matchedRouteOf(request: unknown): MatchedRoute {
  try {
    const meta = (request as { [REQUEST_META]?: { match?: { definition?: { kind?: unknown; pathname?: unknown } } } })[
      REQUEST_META
    ];
    const definition = meta?.match?.definition;
    if (!definition || typeof definition.pathname !== "string") return null;
    const kind = definition.kind === "APP_PAGE" || definition.kind === "APP_ROUTE" ? definition.kind : "OTHER";
    return { kind, template: definition.pathname };
  } catch {
    return null;
  }
}

export type TimingRecord = Readonly<{
  event: "evo_timing";
  v: 1;
  ts: string;
  rel: string;
  class: string;
  kind: TimingKind;
  status: number;
  ms: number;
  ttfb_ms: number | null;
  rpc: number;
  /** Наибольшая последовательная глубина RPC за весь ответ. */
  depth: number;
  /** Она же к моменту отправки заголовков ответа; null — заголовки не отправлены. */
  depth_ttfb: number | null;
  rpc_ms: number;
  rpc_wall_ms: number;
  other: number;
  aborted?: true;
}>;

function round1(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

/** Метка выпуска: версия и 8 знаков ревизии; вне контейнера — `dev`. */
export function releaseLabel(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const metadata = readReleaseMetadata(environment);
  return metadata.status === "available" ? `${metadata.version}+${metadata.shortRevision}` : "dev";
}

export function buildTimingRecord(
  timing: RequestTiming,
  outcome: Readonly<{ status: number; aborted: boolean; route: MatchedRoute }>,
  release: string,
  now: number = performance.now(),
): TimingRecord {
  const route = outcome.route;
  const kind: TimingKind =
    timing.headerKind ?? (route === null ? "other" : route.kind === "APP_ROUTE" ? "route" : "page");
  const routeClass = route ? routeClassFromTemplate(route.template) : null;
  // Клиент ушёл до отправки заголовков: у Node остаётся статус по умолчанию (200),
  // и это было бы ложью. 0 — ответа не было.
  const noResponse = outcome.aborted && timing.ttfbMs === null;
  const status = !noResponse && Number.isInteger(outcome.status) && outcome.status >= 100 && outcome.status <= 599 ? outcome.status : 0;
  // Ответ оборван, а вызовы ещё в полёте: считаем время, которое они уже заняли.
  let rpcMs = timing.rpcMs;
  let rpcWallMs = timing.rpcWallMs;
  for (const call of timing.open) rpcMs += now - call.startedAt;
  if (timing.inflight > 0) rpcWallMs += now - timing.busySince;
  return {
    event: "evo_timing",
    v: 1,
    ts: new Date(timing.startedAtEpochMs).toISOString().slice(0, 19) + "Z",
    rel: /^[A-Za-z0-9._+-]{1,60}$/u.test(release) ? release : "dev",
    class: routeClass ?? "unmatched",
    kind,
    status,
    ms: round1(now - timing.startedAt),
    ttfb_ms: timing.ttfbMs === null ? null : round1(timing.ttfbMs),
    rpc: timing.rpcCount,
    depth: timing.depth,
    depth_ttfb: timing.depthAtHead,
    rpc_ms: round1(rpcMs),
    rpc_wall_ms: round1(rpcWallMs),
    other: timing.otherCount,
    ...(outcome.aborted ? { aborted: true as const } : {}),
  };
}

/**
 * Содержимое `Server-Timing` для локальной отладки. Закрыто по умолчанию:
 * только `development` и `test`; в production (и при незаданном NODE_ENV)
 * заголовка нет.
 */
export function serverTimingHeader(
  timing: RequestTiming,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now: number = performance.now(),
): string | null {
  if (environment.NODE_ENV !== "development" && environment.NODE_ENV !== "test") return null;
  return [
    `rpc;dur=${round1(timing.rpcMs)};desc="n=${timing.rpcCount} depth=${timing.depth}"`,
    `app;dur=${round1(now - timing.startedAt)}`,
  ].join(", ");
}
