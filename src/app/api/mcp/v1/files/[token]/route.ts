import { createAiAgentsMcpFileHandler } from "../../../../../../lib/server/ai-agents/mcp-files.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET serves the file behind a one-time capability link; every other method is 405.
const handler = createAiAgentsMcpFileHandler();

export const GET = handler;
export const POST = handler;
export const HEAD = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
