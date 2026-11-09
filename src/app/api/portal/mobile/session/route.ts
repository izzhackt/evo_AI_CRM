import { createStudentPortalMobileSessionHandler } from "../../../../../lib/server/student-portal-mobile-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentPortalMobileSessionHandler();
