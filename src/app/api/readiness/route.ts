import { platformReadinessRoute } from "@/lib/server/platform-observability-routes";

export const dynamic = "force-dynamic";

export const GET = platformReadinessRoute;
export const HEAD = platformReadinessRoute;
export const POST = platformReadinessRoute;
export const PUT = platformReadinessRoute;
export const PATCH = platformReadinessRoute;
export const DELETE = platformReadinessRoute;
export const OPTIONS = platformReadinessRoute;
