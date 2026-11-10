import { createStaffStudentReceiptDownloadHandler } from "../../../../../../lib/server/student-payment-receipts-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createStaffStudentReceiptDownloadHandler();
