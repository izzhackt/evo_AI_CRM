import { createPlatformTelephonyInboundHandler } from "../../../../../../lib/server/platform-telephony-ingress.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One handler for every method: it answers POST, and 405 with `Allow: POST` for
// anything else, so the answer is the same on the route and in its unit tests.
const handler = createPlatformTelephonyInboundHandler();

export const POST = handler;
export const GET = handler;
export const HEAD = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
