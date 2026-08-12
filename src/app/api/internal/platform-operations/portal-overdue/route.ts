import { createPlatformP6COverdueHandler } from "@/lib/server/platform-p6c-overdue-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformP6COverdueHandler();
