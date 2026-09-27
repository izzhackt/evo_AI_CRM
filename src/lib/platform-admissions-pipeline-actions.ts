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
  /**
   * «Отменить» and «Вернуть в воронку» (251): the version from the receipt of
   * the move being undone. The server refuses with "moved" when someone moved
   * the case since. Ordinary moves send none (last write wins).
   */
  expectedVersion?: number;
}>;

export type MoveCasePipelineActionResult = Readonly<{
  status: MoveCasePipelineActionStatus;
  requestId: string;
  studentCaseId: string;
  /** "saved": the receipt's position; "moved": where the case is now, when the server said so. */
  pipelineStage: AdmissionsPipelineStage | null;
  pipelineHidden: boolean | null;
  pipelineVersion: number | null;
}>;

export async function moveCasePipelineAction(
  input: MoveCasePipelineActionInput,
): Promise<MoveCasePipelineActionResult> {
  const fallback = {
    requestId: input.requestId,
    studentCaseId: input.studentCaseId,
    pipelineStage: null,
    pipelineHidden: null,
    pipelineVersion: null,
  } as const;

  if (
    !UUID_PATTERN.test(input.studentCaseId) ||
    !REQUEST_UUID_PATTERN.test(input.requestId) ||
    (input.remove ? input.stage !== undefined : !input.stage) ||
    (input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1))
  ) {
    return { ...fallback, status: "invalid" };
  }

  const actor = await requirePlatformMutationCapability("admissions.write", "/v3/admissions-pipeline");
  const expected = input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion };

  try {
    const receipt = input.remove
      ? await moveCasePipeline(actor, {
          studentCaseId: input.studentCaseId,
          requestId: input.requestId,
          remove: true,
          ...expected,
        })
      : await moveCasePipeline(actor, {
          studentCaseId: input.studentCaseId,
          requestId: input.requestId,
          stage: input.stage as AdmissionsPipelineStage,
          ...expected,
        });
    revalidatePath("/v3/admissions-pipeline");
    return {
      status: "saved",
      requestId: receipt.requestId,
      studentCaseId: receipt.studentCaseId,
      pipelineStage: receipt.pipelineStage,
      pipelineHidden: receipt.pipelineHidden,
      pipelineVersion: receipt.pipelineVersion,
    };
  } catch (error) {
    if (!(error instanceof PlatformAdmissionsPipelineMutationError)) return { ...fallback, status: "unavailable" };
    if (error.status === "moved") {
      // The board is stale: read it again, and say where the case is now.
      revalidatePath("/v3/admissions-pipeline");
      return error.current
        ? {
            ...fallback,
            status: "moved",
            pipelineStage: error.current.pipelineStage,
            pipelineHidden: error.current.pipelineHidden,
            pipelineVersion: error.current.pipelineVersion,
          }
        : { ...fallback, status: "moved" };
    }
    return { ...fallback, status: error.status };
  }
}
