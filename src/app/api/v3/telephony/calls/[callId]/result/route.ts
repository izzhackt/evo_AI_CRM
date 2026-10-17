import { createTelephonyResultHandler } from "../../../../../../../lib/server/telephony-result-route-handlers.ts";

// Результат звонка одним нажатием (T5): «Дозвонился» / «Перезвонить» + день / «Не интересно».
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createTelephonyResultHandler();
