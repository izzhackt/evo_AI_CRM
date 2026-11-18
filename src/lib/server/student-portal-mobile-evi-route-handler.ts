import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Locale } from "../i18n-data";
import type { EviCoreActor, EviCoreDependencies } from "../portal/evi-core.ts";
import type { EviActionResult } from "../portal/evi.ts";
import type { StudentPortalActorResult } from "../student-portal-auth.ts";
import { readBoundedJsonBody } from "./bounded-json-body.ts";
import { studentPortalDocumentRouteTransport } from "./platform-document-storage-route-handlers.ts";

/**
 * POST /api/portal/mobile/evi — «Подбор с Эви» для мобильного приложения (Expo). Тот же ход разговора, что у веба
 * (`runEviTurn`), но ученик определяется по Bearer-токену сессии Supabase, как у остальных мобильных маршрутов: токен
 * проверяет Supabase Auth (`getClaims`), затем та же цепочка «действующий студент кабинета», что у веб-сессии. Сотрудник и
 * любой не-студент получает 403, нет или просрочен токен — 401; куки не читаются и не ставятся.
 *
 * Тело — один JSON-объект `{ history, locale? }` до 128 КиБ за 5 с (потоковое чтение). Вход истории, согласие на
 * ИИ-помощников, ключ, частота на ученика и ответ модели — в общем ядре; ответ — тот же `EviActionResult`, что у
 * серверного действия, со статусом 200: исход разговора («согласие отозвано», «слишком часто») — не сбой транспорта.
 * Ключ модели живёт только в окружении сервера, приложению не отдаётся.
 */

/** 30 реплик по ≤1200 символов кириллицей (2 байта) + обрамление: с запасом до 128 КиБ, не больше. */
const MAX_BODY_BYTES = 128 * 1024;
const BODY_READ_DEADLINE_MS = 5000;
const MOBILE_LOCALES: readonly Locale[] = ["ru", "ky"];

type MobileEviDependencies = Readonly<{
  /** Проверить токен и определить ученика; клиент несёт тот же токен, поэтому все чтения идут правами ученика. */
  resolveActor: (accessToken: string) => Promise<StudentPortalActorResult>;
  /** Клиент PostgREST с токеном ученика. */
  createClient: (accessToken: string) => Promise<SupabaseClient> | SupabaseClient;
  runTurn: (
    input: Readonly<{ history: unknown; actor: EviCoreActor; client: SupabaseClient; locale: Locale }>,
    dependencies?: EviCoreDependencies,
  ) => Promise<EviActionResult>;
  core?: EviCoreDependencies;
}>;

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse(status, { error });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json\s*(;|$)/iu.test(request.headers.get("content-type") ?? "")) return null;
  try {
    const value = await readBoundedJsonBody(request, { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_READ_DEADLINE_MS });
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createStudentPortalMobileEviHandler(
  overrides?: Partial<MobileEviDependencies>,
): (request: Request) => Promise<Response> {
  const deps: MobileEviDependencies = {
    resolveActor: async (accessToken) => {
      const { resolveStudentPortalBearerActor } = await import("../student-portal-auth.ts");
      return resolveStudentPortalBearerActor(accessToken);
    },
    createClient: async (accessToken) => {
      const { createSupabaseBearerServerClient } = await import("../supabase/server.ts");
      return createSupabaseBearerServerClient(accessToken);
    },
    runTurn: async (input, dependencies) => {
      const { runEviTurn } = await import("../portal/evi-core.ts");
      return runEviTurn(input, dependencies);
    },
    ...overrides,
  };
  return async (request) => {
    // Только Bearer: заголовок обязателен, куки не читаются.
    const transport = studentPortalDocumentRouteTransport(request);
    if (transport.transport !== "bearer") return errorResponse(401, "unauthorized");
    const { accessToken } = transport;

    // Сначала кто спрашивает, потом тело: чужой поток не заставит читать и разбирать большие тела.
    const result = await deps.resolveActor(accessToken);
    if (result.status !== "authenticated") {
      if (result.status === "anonymous") return errorResponse(401, "unauthorized");
      if (result.reason === "student_authority_unavailable") return errorResponse(503, "unavailable");
      // Сессия не принята Auth — 401; токен верный, но владелец не действующий студент (сотрудник, закрытый доступ) — 403.
      return result.reason === "supabase_session_invalid" ? errorResponse(401, "unauthorized") : errorResponse(403, "not_a_student");
    }

    const body = await readJsonObject(request);
    if (!body || !Object.keys(body).every((key) => key === "history" || key === "locale") || !("history" in body)) {
      return errorResponse(400, "invalid_request");
    }
    const locale = body.locale === undefined ? "ru" : body.locale;
    if (typeof locale !== "string" || !(MOBILE_LOCALES as readonly string[]).includes(locale)) {
      return errorResponse(400, "invalid_request");
    }

    let client: SupabaseClient;
    try {
      client = await deps.createClient(accessToken);
    } catch {
      return errorResponse(503, "unavailable");
    }
    try {
      const outcome = await deps.runTurn(
        { history: body.history, actor: result.actor, client, locale: locale as Locale },
        deps.core,
      );
      return jsonResponse(200, outcome);
    } catch {
      // Ядро само превращает сбои модели в `{ ok: false }`; сюда попадает только неожиданное — без текстов и ключей.
      return jsonResponse(200, { ok: false, reason: "error" } satisfies EviActionResult);
    }
  };
}
