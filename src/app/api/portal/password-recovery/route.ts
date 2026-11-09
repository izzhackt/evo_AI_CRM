import { createStudentPortalPasswordRecoveryHandler } from "../../../../lib/server/student-portal-password-recovery-route-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentPortalPasswordRecoveryHandler();
