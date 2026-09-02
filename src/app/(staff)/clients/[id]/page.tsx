import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  PLATFORM_CONTRACT_MUTATION_OUTCOMES,
  PLATFORM_CONTRACT_RETRY_OPERATIONS,
  parsePlatformContractUuid,
  type PlatformContractMutationOutcome,
  type PlatformContractRetryOperation,
} from "@/lib/platform-contract-workflow";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { StudentCaseWorkspace } from "./StudentCaseWorkspace";

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
  return (
    <StudentCaseWorkspace
      id={id}
      contractResult={contractResult}
      contractRetry={parseContractRetry(resolvedSearchParams, contractResult)}
    />
  );
}
