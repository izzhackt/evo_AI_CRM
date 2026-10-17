import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { DIAL_OFF, dialOptionsState, type DialOptions } from "./telephony-dial.ts";

/**
 * Показывать ли сотруднику кнопку «Позвонить» («Телефония Beeline KG», срез T7; миграция 299,
 * `platform.telephony_dial_options_v1`). Читает база под сессией сотрудника: набор открыт, если
 * в настройках включены `ui_enabled` и `dial_enabled`, нет паузы исходящих и у сотрудника есть
 * право `telephony.call.dial`; заодно база говорит, сопоставлен ли он с пользователем ВАТС.
 *
 * Просмотр роли, отсутствие права (его знает сессия — лишний запрос не нужен) и любой сбой
 * чтения — «выключено»: кнопки просто нет, страница не ломается и ничего не обещает. Номера
 * клиента и логина ВАТС в ответе нет.
 */
export async function readDialOptions(actor: ActivePlatformActor): Promise<DialOptions> {
  if (isStaffPreview(actor) || !staffHasPermission(actor, "telephony.call.dial")) return DIAL_OFF;
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform")
      .rpc("telephony_dial_options_v1", { p_organization_id: actor.organizationId });
    return error ? DIAL_OFF : dialOptionsState(data);
  } catch {
    return DIAL_OFF;
  }
}
