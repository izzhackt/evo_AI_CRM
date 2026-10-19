import { createStaffNotificationsStateHandler } from "../../../../../lib/server/light-poll-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createStaffNotificationsStateHandler();
