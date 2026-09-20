import { createStudentPortalRegistrationHandler } from "../../../../lib/server/student-portal-intake-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentPortalRegistrationHandler();
