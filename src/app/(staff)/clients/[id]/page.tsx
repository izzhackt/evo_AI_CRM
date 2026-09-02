import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  PlatformAdmissionsOperationsFeedback,
} from "@/components/platform/admissions/PlatformAdmissionsOperationsPanel";
import type {
  PlatformAdmissionsTaskFeedback,
} from "@/components/platform/admissions/PlatformAdmissionsTaskPanel";
import type {
  PlatformDocumentReviewFeedback,
} from "@/components/platform/documents/PlatformPrivateDocumentsPanel";
import {
  PLATFORM_CONTRACT_MUTATION_OUTCOMES,
  PLATFORM_CONTRACT_RETRY_OPERATIONS,
  parsePlatformContractUuid,
  type PlatformContractMutationOutcome,
  type PlatformContractRetryOperation,
} from "@/lib/platform-contract-workflow";
import { buildRouteMetadata } from "@/lib/route-metadata";
import {
  StudentCaseWorkspace,
  type StudentCaseApplicationRetry,
  type StudentCaseDocumentRetry,
  type StudentCaseFinanceStopRetry,
  type StudentCaseOperationRetry,
  type StudentCaseTaskRetry,
} from "./StudentCaseWorkspace";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "Student 360",
    ky: "Student 360",
    en: "Student 360",
  });
}

type ClientSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function singleSearchParam(value: string | readonly string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

type MutationOutcome = "saved" | "invalid" | "unavailable";

function parseMutationOutcome(
  searchParams: ClientSearchParams,
  key: string,
): MutationOutcome | undefined {
  const candidate = singleSearchParam(searchParams[key]);
  return candidate === "saved" ||
    candidate === "invalid" ||
    candidate === "unavailable"
    ? candidate
    : undefined;
}

function parseUuidSearchParam(
  searchParams: ClientSearchParams,
  key: string,
): string | undefined {
  const candidate = singleSearchParam(searchParams[key]);
  return candidate && UUID_PATTERN.test(candidate)
    ? candidate.toLowerCase()
    : undefined;
}

function parseTaskContext(searchParams: ClientSearchParams) {
  const outcome = parseMutationOutcome(searchParams, "task_result");
  const operationCandidate = singleSearchParam(
    searchParams.task_retry_operation,
  );
  const operation = operationCandidate === "create" ||
    operationCandidate === "change"
    ? operationCandidate
    : null;
  const subjectId = parseUuidSearchParam(searchParams, "task_subject_id");
  const requestId = parseUuidSearchParam(
    searchParams,
    "task_retry_request_id",
  );
  const feedback: PlatformAdmissionsTaskFeedback | undefined = outcome
    ? { outcome, operation, subjectId: subjectId ?? null }
    : undefined;
  const retry: StudentCaseTaskRetry | undefined =
    outcome !== "saved" &&
    outcome !== undefined &&
    requestId &&
    operation &&
    (operation === "create" || subjectId)
      ? {
          requestId,
          operation,
          ...(subjectId ? { subjectId } : {}),
        }
      : undefined;
  return { feedback, retry };
}

function parseApplicationContext(searchParams: ClientSearchParams) {
  const outcome = parseMutationOutcome(searchParams, "application_result");
  const operationCandidate = singleSearchParam(
    searchParams.application_retry_operation,
  );
  const operation = operationCandidate === "create" ||
    operationCandidate === "change"
    ? operationCandidate
    : null;
  const subjectId = parseUuidSearchParam(
    searchParams,
    "application_retry_subject_id",
  );
  const requestId = parseUuidSearchParam(
    searchParams,
    "application_retry_request_id",
  );
  const feedback: PlatformAdmissionsOperationsFeedback["applications"] = outcome
    ? { outcome, operation, subjectId: subjectId ?? null }
    : undefined;
  const retry: StudentCaseApplicationRetry | undefined =
    outcome !== "saved" &&
    outcome !== undefined &&
    requestId &&
    operation &&
    (operation === "create" || subjectId)
      ? {
          requestId,
          operation,
          ...(subjectId ? { subjectId } : {}),
        }
      : undefined;
  return { feedback, retry };
}

function parseCaseOperationContext(searchParams: ClientSearchParams) {
  const outcome = parseMutationOutcome(searchParams, "p6d_result");
  const operationCandidate = singleSearchParam(
    searchParams.p6d_retry_operation,
  );
  const operation = operationCandidate === "visa" ||
    operationCandidate === "payment-create" ||
    operationCandidate === "payment-settle"
    ? operationCandidate
    : null;
  const subjectId = parseUuidSearchParam(searchParams, "p6d_subject_id");
  const requestId = parseUuidSearchParam(
    searchParams,
    "p6d_retry_request_id",
  );
  const feedback: PlatformAdmissionsOperationsFeedback["caseOperations"] =
    outcome
      ? { outcome, operation, subjectId: subjectId ?? null }
      : undefined;
  const retry: StudentCaseOperationRetry | undefined =
    outcome !== "saved" &&
    outcome !== undefined &&
    requestId &&
    operation &&
    (operation !== "payment-settle" || subjectId)
      ? {
          requestId,
          operation,
          ...(subjectId ? { subjectId } : {}),
        }
      : undefined;
  return { feedback, retry };
}

function parseFinanceStopContext(searchParams: ClientSearchParams) {
  const outcome = parseMutationOutcome(searchParams, "u8_result");
  const operationCandidate = singleSearchParam(
    searchParams.u8_retry_operation,
  );
  const operation = operationCandidate === "stop-create" ||
    operationCandidate === "stop-resolve"
    ? operationCandidate
    : null;
  const subjectId = parseUuidSearchParam(searchParams, "u8_subject_id");
  const requestId = parseUuidSearchParam(
    searchParams,
    "u8_retry_request_id",
  );
  const feedback: PlatformAdmissionsOperationsFeedback["financeStops"] = outcome
    ? { outcome, operation, subjectId: subjectId ?? null }
    : undefined;
  const retry: StudentCaseFinanceStopRetry | undefined =
    outcome !== "saved" &&
    outcome !== undefined &&
    requestId &&
    operation &&
    subjectId
      ? { requestId, operation, subjectId }
      : undefined;
  return { feedback, retry };
}

function parseDocumentContext(searchParams: ClientSearchParams) {
  const outcome = parseMutationOutcome(searchParams, "document_result");
  const subjectId = parseUuidSearchParam(
    searchParams,
    "document_retry_subject_id",
  );
  const requestId = parseUuidSearchParam(
    searchParams,
    "document_retry_request_id",
  );
  const feedback: PlatformDocumentReviewFeedback | undefined = outcome
    ? { outcome, subjectId: subjectId ?? null }
    : undefined;
  const retry: StudentCaseDocumentRetry | undefined =
    outcome !== "saved" && outcome !== undefined && requestId && subjectId
      ? { requestId, subjectId }
      : undefined;
  return { feedback, retry };
}

function parseContractResult(
  searchParams: ClientSearchParams,
): PlatformContractMutationOutcome | undefined {
  const candidate = singleSearchParam(searchParams.bw6_result);
  return PLATFORM_CONTRACT_MUTATION_OUTCOMES.find(
    (outcome) => outcome === candidate,
  );
}

function parseContractRetry(
  searchParams: ClientSearchParams,
  result: PlatformContractMutationOutcome | undefined,
) {
  if (result !== "invalid" && result !== "unavailable") return undefined;
  const requestId = parsePlatformContractUuid(
    singleSearchParam(searchParams.bw6_retry_request_id),
  );
  const operationCandidate = singleSearchParam(
    searchParams.bw6_retry_operation,
  );
  const operation: PlatformContractRetryOperation | undefined =
    PLATFORM_CONTRACT_RETRY_OPERATIONS.find(
      (value) => value === operationCandidate,
    );
  const subjectCandidate = singleSearchParam(searchParams.bw6_subject_id);
  const subjectId = subjectCandidate
    ? parsePlatformContractUuid(subjectCandidate)
    : undefined;

  if (!requestId || !operation || (subjectCandidate && !subjectId)) {
    return undefined;
  }
  return subjectId
    ? ({ requestId, operation, subjectId } as const)
    : ({ requestId, operation } as const);
}

export default async function ClientPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<ClientSearchParams>;
}>) {
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!UUID_PATTERN.test(id)) notFound();
  const contractResult = parseContractResult(resolvedSearchParams);
  const task = parseTaskContext(resolvedSearchParams);
  const applications = parseApplicationContext(resolvedSearchParams);
  const caseOperations = parseCaseOperationContext(resolvedSearchParams);
  const financeStops = parseFinanceStopContext(resolvedSearchParams);
  const documents = parseDocumentContext(resolvedSearchParams);
  return (
    <StudentCaseWorkspace
      id={id}
      contractResult={contractResult}
      contractRetry={parseContractRetry(resolvedSearchParams, contractResult)}
      taskFeedback={task.feedback}
      taskRetry={task.retry}
      operationsFeedback={{
        applications: applications.feedback,
        caseOperations: caseOperations.feedback,
        financeStops: financeStops.feedback,
      }}
      applicationRetry={applications.retry}
      caseOperationRetry={caseOperations.retry}
      financeStopRetry={financeStops.retry}
      documentFeedback={documents.feedback}
      documentRetry={documents.retry}
    />
  );
}
