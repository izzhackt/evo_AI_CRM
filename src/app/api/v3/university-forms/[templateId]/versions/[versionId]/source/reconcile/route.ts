import { createUniversityTemplateIngressHandlers, universityTemplateMethodNotAllowed } from "../../../../../../../../../lib/server/university-template-ingress-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createUniversityTemplateIngressHandlers().reconcile;
export const GET = () => universityTemplateMethodNotAllowed("POST");
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
