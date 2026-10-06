"use server";
import { revalidatePath } from "next/cache";

import type { AiActionState } from "./platform-ai-agent-actions";
import { staffCanAccessRoute } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import {
  aiAutosendSettingsIssues,
  normalizeAiAutosendSettings,
  type AiAutosendSettings,
} from "./v3/ai-agent-autosend";
import {
  enableAiAutosend,
  pauseAiAutosend,
  saveAiAutosendSettings,
  setAiAutosendShadow,
  type AiAutosendWriteStatus,
} from "./v3/ai-agent-autosend-source";

/**
 * Записи «Автоответчика» (P4, план §11; Q9 — любой сотрудник раздела). Каждая
 * запись — один RPC с id запроса: повтор тем же id возвращает прежнюю
 * квитанцию, другой ввод — конфликт. Включение, режим, пауза и права —
 * решение базы (277); здесь только форма ввода.
 */
export type AiAutosendActionState = AiActionState;

const VERSION = /^(?:0|[1-9]\d{0,14})$/u;
/** Настройки целиком — несколько килобайт JSON; больше — не наша форма. */
const SETTINGS_JSON_LIMIT = 32_768;

async function actorFor() {
  const actor = await requirePlatformStaffActor();
  return staffCanAccessRoute(actor, "/v3/ai-agent") ? actor : null;
}

function done(status: AiAutosendWriteStatus, requestId: string): AiAutosendActionState {
  if (status === "saved") revalidatePath("/v3/ai-agent");
  return { status, requestId };
}

/** «Сохранить настройки»: все настройки одной записью с ожидаемой версией (PT409 — «обновите страницу»). */
export async function saveAiAutosendSettingsAction(previous: AiAutosendActionState, form: FormData): Promise<AiAutosendActionState> {
  const fields = exactActionStringFields(form, ["request_id", "expected_version", "settings"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (!fields || !requestId) return { status: "invalid", requestId: previous.requestId };
  const expected = fields.get("expected_version")!;
  const raw = fields.get("settings")!;
  if (!VERSION.test(expected) || raw.length > SETTINGS_JSON_LIMIT) return { status: "invalid", requestId };
  let settings: AiAutosendSettings;
  try {
    settings = normalizeAiAutosendSettings(JSON.parse(raw));
  } catch {
    return { status: "invalid", requestId };
  }
  if (aiAutosendSettingsIssues(settings).length > 0) return { status: "invalid", requestId };
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await saveAiAutosendSettings(actor, { settings, expectedVersion: Number(expected), requestId }), requestId);
}

/**
 * «Включить автоответчик» / «Выключить автоответчик». Включивший становится
 * ответственным; первое включение — «Проверка без отправки» (решает база).
 */
export async function toggleAiAutosendAction(previous: AiAutosendActionState, form: FormData): Promise<AiAutosendActionState> {
  const fields = exactActionStringFields(form, ["request_id", "expected_version", "autosend_action"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const action = fields?.get("autosend_action");
  const expected = fields?.get("expected_version") ?? "";
  if (!fields || !requestId || (action !== "enable" && action !== "disable") || !VERSION.test(expected)) {
    return { status: "invalid", requestId: requestId ?? previous.requestId };
  }
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await enableAiAutosend(actor, { enabled: action === "enable", expectedVersion: Number(expected), requestId }), requestId);
}

/** «Проверка без отправки» ↔ «Отвечает». «Отвечает» — после трёх ночей проверки (PT412). */
export async function setAiAutosendModeAction(previous: AiAutosendActionState, form: FormData): Promise<AiAutosendActionState> {
  const fields = exactActionStringFields(form, ["request_id", "expected_version", "mode"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const mode = fields?.get("mode");
  const expected = fields?.get("expected_version") ?? "";
  if (!fields || !requestId || (mode !== "shadow" && mode !== "live") || !VERSION.test(expected)) {
    return { status: "invalid", requestId: requestId ?? previous.requestId };
  }
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await setAiAutosendShadow(actor, { shadow: mode === "shadow", expectedVersion: Number(expected), requestId }), requestId);
}

/** «Поставить на паузу» / «Снять паузу» — только человек; снятие обнуляет счётчики ошибок. */
export async function pauseAiAutosendAction(previous: AiAutosendActionState, form: FormData): Promise<AiAutosendActionState> {
  const fields = exactActionStringFields(form, ["request_id", "expected_version", "pause_action"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const action = fields?.get("pause_action");
  const expected = fields?.get("expected_version") ?? "";
  if (!fields || !requestId || (action !== "pause" && action !== "resume") || !VERSION.test(expected)) {
    return { status: "invalid", requestId: requestId ?? previous.requestId };
  }
  const actor = await actorFor();
  if (!actor) return { status: "forbidden", requestId };
  return done(await pauseAiAutosend(actor, { action, expectedVersion: Number(expected), requestId }), requestId);
}
