import {
  createStudentPortalMobileEviHandler,
  createStudentPortalMobileEviStatusHandler,
} from "../../../../../lib/server/student-portal-mobile-evi-route-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// POST — ход разговора, GET — «есть ли у сервера ключ Эви» (один флаг, только Bearer).
export const POST = createStudentPortalMobileEviHandler();
export const GET = createStudentPortalMobileEviStatusHandler();
