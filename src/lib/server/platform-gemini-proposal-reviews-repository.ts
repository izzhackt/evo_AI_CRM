import "server-only";

import type { PlatformActor } from "../platform-auth";
import {
  buildPlatformGeminiReviewMutationRpcArgs,
  buildPlatformGeminiReviewReadRpcArgs,
  normalizePlatformGeminiProposalReview,
  normalizePlatformGeminiProposalReviewHistory,
  PlatformGeminiProposalReviewContractError,
  type PlatformGeminiProposalReview,
  type PlatformGeminiProposalReviewDecision,
} from "../platform-gemini-proposal-reviews.ts";

export const PLATFORM_GEMINI_PROPOSAL_REVIEW_RPC = "review_gemini_proposal";
export const PLATFORM_GEMINI_PROPOSAL_REVIEW_STAFF_RPC =
  "staff_gemini_proposal_reviews";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
export type PlatformGeminiProposalReviewRpcClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      name: string,
      args: Record<string, unknown>,
      options?: Readonly<{ get?: boolean }>,
    ): Promise<RpcResponse>;
  }>;
}>;

type RepositoryDependencies = Readonly<{
  client?: PlatformGeminiProposalReviewRpcClient;
}>;

export class PlatformGeminiProposalReviewRepositoryError extends Error {
  constructor() {
    super("Platform Gemini proposal review repository is unavailable.");
    this.name = "PlatformGeminiProposalReviewRepositoryError";
  }
}

function failClosed(error?: unknown): never {
  if (
    error instanceof PlatformGeminiProposalReviewRepositoryError ||
    error instanceof PlatformGeminiProposalReviewContractError
  ) {
    throw error;
  }
  throw new PlatformGeminiProposalReviewRepositoryError();
}

async function getClient(
  dependencies: RepositoryDependencies,
): Promise<PlatformGeminiProposalReviewRpcClient> {
  if (dependencies.client) return dependencies.client;
  const { createSupabaseServerClient } = await import("../supabase/server");
  return (await createSupabaseServerClient()) as unknown as PlatformGeminiProposalReviewRpcClient;
}

export async function readPlatformGeminiProposalReviews(
  actor: PlatformActor,
  conversationId: string,
  limit = 20,
  dependencies: RepositoryDependencies = {},
): Promise<readonly PlatformGeminiProposalReview[]> {
  try {
    const args = buildPlatformGeminiReviewReadRpcArgs({
      organizationId: actor.organizationId,
      conversationId,
      limit,
    });
    const client = await getClient(dependencies);
    const response = await client
      .schema("platform")
      .rpc(PLATFORM_GEMINI_PROPOSAL_REVIEW_STAFF_RPC, args, { get: true });
    if (response.error) failClosed();
    return normalizePlatformGeminiProposalReviewHistory(response.data, limit);
  } catch (error) {
    return failClosed(error);
  }
}

export async function reviewPlatformGeminiProposal(
  actor: PlatformActor,
  input: Readonly<{
    conversationId: string;
    proposalRequestId: string;
    reviewRequestId: string;
    decision: PlatformGeminiProposalReviewDecision;
    reviewedPayload: unknown;
    reason: string | null;
  }>,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformGeminiProposalReview> {
  try {
    const args = buildPlatformGeminiReviewMutationRpcArgs({
      organizationId: actor.organizationId,
      ...input,
    });
    const client = await getClient(dependencies);
    const response = await client
      .schema("platform")
      .rpc(PLATFORM_GEMINI_PROPOSAL_REVIEW_RPC, args);
    if (response.error || !Array.isArray(response.data) || response.data.length !== 1) {
      failClosed();
    }
    const review = normalizePlatformGeminiProposalReview(response.data[0], {
      mutation: true,
    });
    if (
      review.proposalRequestId !== args.p_proposal_request_id ||
      review.decision !== args.p_decision
    ) {
      failClosed();
    }
    return review;
  } catch (error) {
    return failClosed(error);
  }
}
