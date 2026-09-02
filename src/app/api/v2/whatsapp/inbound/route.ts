import { createPlatformWahaWebhookHandler } from "../../../../../lib/server/platform-waha-webhook.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPlatformWahaWebhookHandler();
