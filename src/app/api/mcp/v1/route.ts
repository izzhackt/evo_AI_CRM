import { createAiAgentsMcpHandler } from "../../../../lib/server/ai-agents/mcp-server.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One handler for every method: it answers POST, and 405 with `Allow: POST` for
// anything else (a GET event stream is not offered; the MCP spec allows that).
const handler = createAiAgentsMcpHandler();

export const POST = handler;
export const GET = handler;
export const HEAD = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
