import { createPlatformWahaIngressHandler } from "@/lib/server/platform-waha-ingress-repository.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformWahaIngressHandler();
