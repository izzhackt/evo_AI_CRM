import { createAiAgentsMcpFileHandler } from "../../../../../../lib/server/ai-agents/mcp-files.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET serves the file behind a one-time capability link; every other method is 405.
const handler = createAiAgentsMcpFileHandler();

// Next types a dynamic route's second argument as required, so the shared handler
// (whose context is optional for tests) is wrapped with the required form.
type FileRouteContext = Readonly<{ params: Promise<{ token: string }> }>;
const run = (request: Request, context: FileRouteContext): Promise<Response> => handler(request, context);

export const GET = run;
export const POST = run;
export const HEAD = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
export const OPTIONS = run;
