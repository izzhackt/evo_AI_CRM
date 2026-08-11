import { createPlatformGeminiProposalHandler } from "@/lib/server/platform-gemini-proposal-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformGeminiProposalHandler();
