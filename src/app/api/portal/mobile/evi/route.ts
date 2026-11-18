import { createStudentPortalMobileEviHandler } from "../../../../../lib/server/student-portal-mobile-evi-route-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentPortalMobileEviHandler();
