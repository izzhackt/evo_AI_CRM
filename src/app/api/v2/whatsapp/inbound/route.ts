import { createCanonicalWhatsAppInboundHandler } from "../../../../../lib/server/canonical-whatsapp-inbound.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createCanonicalWhatsAppInboundHandler();
