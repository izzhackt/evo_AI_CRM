import { knowledgeHttp } from "@/lib/server/knowledge-library/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 7200;
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) { return knowledgeHttp(request, (await context.params).path); }
export async function POST(request: Request, context: Context) { return knowledgeHttp(request, (await context.params).path); }
