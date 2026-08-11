import "server-only";

import type { PlatformActor } from "../platform-auth";
import {
  buildPlatformGeminiStaffReadRpcArgs,
  normalizePlatformGeminiProposal,
  PlatformGeminiProposalContractError,
  type PlatformGeminiProposal,
} from "../platform-gemini-proposals.ts";

export const PLATFORM_GEMINI_PROPOSAL_STAFF_RPC = "staff_gemini_proposal";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
export type PlatformGeminiProposalRpcClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      name: string,
      args: Record<string, unknown>,
      options?: Readonly<{ get?: boolean }>,
    ): Promise<RpcResponse>;
  }>;
}>;

type RepositoryDependencies = Readonly<{
  client?: PlatformGeminiProposalRpcClient;
}>;

export class PlatformGeminiProposalRepositoryError extends Error {
  constructor() {
    super("Platform Gemini proposal repository is unavailable.");
    this.name = "PlatformGeminiProposalRepositoryError";
  }
}

function failClosed(error?: unknown): never {
  if (
    error instanceof PlatformGeminiProposalRepositoryError ||
    error instanceof PlatformGeminiProposalContractError
  ) {
    throw error;
  }
  throw new PlatformGeminiProposalRepositoryError();
}

async function getClient(
  dependencies: RepositoryDependencies,
): Promise<PlatformGeminiProposalRpcClient> {
  if (dependencies.client) return dependencies.client;
  const { createSupabaseServerClient } = await import("../supabase/server");
  return (await createSupabaseServerClient()) as unknown as PlatformGeminiProposalRpcClient;
}

export async function readPlatformGeminiProposal(
  actor: PlatformActor,
  conversationId: string,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformGeminiProposal | null> {
  try {
    const args = buildPlatformGeminiStaffReadRpcArgs({
      organizationId: actor.organizationId,
      conversationId,
    });
    const client = await getClient(dependencies);
    const response = await client
      .schema("platform")
      .rpc(PLATFORM_GEMINI_PROPOSAL_STAFF_RPC, args, { get: true });
    if (response.error || !Array.isArray(response.data) || response.data.length > 1) {
      failClosed();
    }
    return response.data.length === 0
      ? null
      : normalizePlatformGeminiProposal(response.data[0]);
  } catch (error) {
    return failClosed(error);
  }
}
