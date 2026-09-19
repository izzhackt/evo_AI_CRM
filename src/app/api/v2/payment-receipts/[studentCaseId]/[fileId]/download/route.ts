import { createPaymentReceiptFileDownloadHandler } from "../../../../../../../lib/server/platform-case-agreement-storage-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPaymentReceiptFileDownloadHandler();
