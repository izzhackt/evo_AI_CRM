"use server";

/**
 * OTH-1 «Воронка поступления» — board mutation. Style follows
 * src/lib/platform-sales-actions.ts (requirePlatformMutationCapability,
 * request-id round-trip, revalidatePath on success), but this action takes
 * typed arguments instead of FormData: its two callers are a native
 * drag-and-drop drop handler and the «Переместить в…» menu, neither of which
 * is a browser form submission, so there is no FormData to parse. Both
 * callers invoke this same function from client code (via useTransition),
 * which keeps the move logic and the optimistic-revert contract identical
 * for both the pointer and the keyboard/phone path.
 */
import { revalidatePath } from "next/cache";

import { requirePlatformMutationCapability } from "./platform-guards";
import {
  moveCasePipeline,
  PlatformAdmissionsPipelineMutationError,
  type AdmissionsPipelineStage,
  type MoveCasePipelineStatus,
} from "./platform-admissions-pipeline";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MoveCasePipelineActionStatus = MoveCasePipelineStatus | "invalid";

export type MoveCasePipelineActionInput = Readonly<{
  studentCaseId: string;
  requestId: string;
  stage?: AdmissionsPipelineStage;
  remove?: boolean;
}>;

export type MoveCasePipelineActionResult = Readonly<{
  status: MoveCasePipelineActionStatus;
  requestId: string;
  studentCaseId: string;
  pipelineStage: AdmissionsPipelineStage | null;
  pipelineHidden: boolean | null;
}>;

export async function moveCasePipelineAction(
  input: MoveCasePipelineActionInput,
): Promise<MoveCasePipelineActionResult> {
  const fallback = {
    requestId: input.requestId,
    studentCaseId: input.studentCaseId,
    pipelineStage: null,
    pipelineHidden: null,
  } as const;

  if (
    !UUID_PATTERN.test(input.studentCaseId) ||
    !REQUEST_UUID_PATTERN.test(input.requestId) ||
    (input.remove ? input.stage !== undefined : !input.stage)
  ) {
    return { ...fallback, status: "invalid" };
  }

  const actor = await requirePlatformMutationCapability("admissions.write", "/v3/admissions-pipeline");

  try {
    const receipt = input.remove
      ? await moveCasePipeline(actor, {
          studentCaseId: input.studentCaseId,
          requestId: input.requestId,
          remove: true,
        })
      : await moveCasePipeline(actor, {
          studentCaseId: input.studentCaseId,
          requestId: input.requestId,
          stage: input.stage as AdmissionsPipelineStage,
        });
    revalidatePath("/v3/admissions-pipeline");
    return {
      status: "saved",
      requestId: receipt.requestId,
      studentCaseId: receipt.studentCaseId,
      pipelineStage: receipt.pipelineStage,
      pipelineHidden: receipt.pipelineHidden,
    };
  } catch (error) {
    const status: MoveCasePipelineActionStatus =
      error instanceof PlatformAdmissionsPipelineMutationError ? error.status : "unavailable";
    return { ...fallback, status };
  }
}
