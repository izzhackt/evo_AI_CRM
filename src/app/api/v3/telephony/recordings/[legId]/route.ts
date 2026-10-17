import {
  createTelephonyRecordingHandler,
  telephonyRecordingMethodNotAllowed,
} from "../../../../../../lib/server/telephony-recording-route-handlers.ts";

// Прослушивание записи звонка (T6): потоковый прокси, копий нет. Только GET.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createTelephonyRecordingHandler();
export const HEAD = telephonyRecordingMethodNotAllowed;
export const OPTIONS = telephonyRecordingMethodNotAllowed;
