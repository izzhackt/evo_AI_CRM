/**
 * Пояс, в котором у организации идут сутки.
 *
 * Соединение с базой живёт в своём поясе, и он не обязан совпадать с тем, по
 * которому работают люди: без явного пояса задача со сроком 01:00 попадала бы
 * на предыдущий день, а «сегодня» на экране менялось бы не в полночь.
 *
 * Поэтому границы суток и текущая дата считаются здесь одним именем, а в
 * запросах пишутся как `(now() at time zone ${ORG_TIMEZONE})` и
 * `t.due_at at time zone ${ORG_TIMEZONE}`. Пояс соединения
 * (`src/lib/server/database.ts`) при этом не трогается: файл общий с V2.
 */

import { PLATFORM_ORGANIZATION_TIMEZONE } from "../platform-organization-time.ts";

/** Пояс организации. Заказчик его ещё не назвал — до тех пор Asia/Bishkek. */
export const ORG_TIMEZONE = PLATFORM_ORGANIZATION_TIMEZONE;
