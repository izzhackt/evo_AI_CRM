import { createUniversityTemplateIngressHandlers, universityTemplateMethodNotAllowed } from "../../../../../../../../lib/server/university-template-ingress-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createUniversityTemplateIngressHandlers();
export const GET = handlers.read;
export const POST = handlers.upload;
export const HEAD = () => universityTemplateMethodNotAllowed("GET, POST");
export const PUT = HEAD;
export const PATCH = HEAD;
export const DELETE = HEAD;
export const OPTIONS = HEAD;
