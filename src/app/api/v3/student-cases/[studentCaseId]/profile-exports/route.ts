import {
  createStudentProfileExportHandler,
  studentProfileExportMethodNotAllowed,
} from "../../../../../../lib/server/student-profile-export-route-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentProfileExportHandler();
export const GET = studentProfileExportMethodNotAllowed;
export const HEAD = studentProfileExportMethodNotAllowed;
export const PUT = studentProfileExportMethodNotAllowed;
export const PATCH = studentProfileExportMethodNotAllowed;
export const DELETE = studentProfileExportMethodNotAllowed;
export const OPTIONS = studentProfileExportMethodNotAllowed;
