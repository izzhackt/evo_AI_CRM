import {
  createTelephonyDialHandler,
  telephonyDialMethodNotAllowed,
} from "../../../../../lib/server/telephony-dial-route-handlers.ts";

// «Позвонить» (T7): ВАТС звонит сотруднику, потом клиенту. Только POST; номер клиента браузер не присылает.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createTelephonyDialHandler();
export const GET = telephonyDialMethodNotAllowed;
export const HEAD = telephonyDialMethodNotAllowed;
export const PUT = telephonyDialMethodNotAllowed;
export const PATCH = telephonyDialMethodNotAllowed;
export const DELETE = telephonyDialMethodNotAllowed;
export const OPTIONS = telephonyDialMethodNotAllowed;
