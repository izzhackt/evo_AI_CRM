import { randomUUID } from "node:crypto";

import { PartShell } from "@/components/v3/PartShell";
import { Profile } from "@/components/v3/profile/Profile";
import { ProfileCaseDirectory } from "@/components/v3/profile/ProfileCaseDirectory";
import {
  buildV3ProfileHref,
  resolveTab,
  type ProfileContractRetry,
  type ProfileRouteTarget,
} from "@/components/v3/profile/types";
import {
  PLATFORM_CONTRACT_MUTATION_OUTCOMES,
  PLATFORM_CONTRACT_RETRY_OPERATIONS,
  parsePlatformContractUuid,
  type PlatformContractMutationOutcome,
} from "@/lib/platform-contract-workflow";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  parseV3ProfileCaseDirectoryParams,
  readProfilePicks,
  readProfileTarget,
  readV3ProfileCaseDirectory,
} from "@/lib/v3/profile-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Профиль" };

type ProfileSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function singleSearchParam(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseContractResult(
  searchParams: ProfileSearchParams,
): PlatformContractMutationOutcome | undefined {
  const candidate = singleSearchParam(searchParams.bw6_result);
  return PLATFORM_CONTRACT_MUTATION_OUTCOMES.find(
    (outcome) => outcome === candidate,
  );
}

function parseContractRetry(
  searchParams: ProfileSearchParams,
  result: PlatformContractMutationOutcome | undefined,
): ProfileContractRetry | undefined {
  if (result !== "invalid" && result !== "unavailable") return undefined;
  const requestId = parsePlatformContractUuid(
    singleSearchParam(searchParams.bw6_retry_request_id),
  );
  const operationCandidate = singleSearchParam(
    searchParams.bw6_retry_operation,
  );
  const operation = PLATFORM_CONTRACT_RETRY_OPERATIONS.find(
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
    ? { requestId, operation, subjectId }
    : { requestId, operation };
}

export default async function ProfilePart({
  searchParams,
}: {
  searchParams: Promise<ProfileSearchParams>;
}) {
  const actor = await requireV3PageActor("/v3/profile");
  const params = await searchParams;
  const directoryParams = parseV3ProfileCaseDirectoryParams(params);
  const [picks, directory] = await Promise.all([
    readProfilePicks(actor),
    readV3ProfileCaseDirectory(actor, directoryParams),
  ]);

  // Lead and Student Case are different canonical identities. A requested
  // value is never substituted with the first picker row, and the two query
  // parameters are never interpreted as each other.
  const leadParam = singleSearchParam(params.id);
  const caseParam = singleSearchParam(params.case);
  const hasLeadParam = params.id !== undefined;
  const hasCaseParam = params.case !== undefined;
  const explicitTarget: ProfileRouteTarget | null = leadParam && !hasCaseParam
    ? { leadId: leadParam, studentCaseId: null }
    : caseParam && !hasLeadParam
      ? { leadId: null, studentCaseId: caseParam }
      : null;
  const hasExplicitTarget = hasLeadParam || hasCaseParam;
  const target = hasExplicitTarget
    ? explicitTarget
    : directoryParams.active
      ? null
      : picks[0]?.target ?? null;
  const view = target ? await readProfileTarget(actor, target) : null;
  const missing = hasExplicitTarget && !view;
  const ambiguous = hasLeadParam && hasCaseParam;
  // Вкладка приходит адресом, поэтому её нельзя брать на веру: чужое слово и
  // вкладка, которой у этого человека нет (`?tab=documents` у лида), открывают
  // обзор.
  const tab = resolveTab(
    singleSearchParam(params.tab),
    Boolean(view?.profile.student),
    actor.presentationRole,
  );
  const hrefFor = (next: string) => view
    ? buildV3ProfileHref(view.details.routeTarget, next)
    : "/v3/profile";
  const requestIds = {
    contract: randomUUID(),
    firstPayment: randomUUID(),
    override: randomUUID(),
    handoff: randomUUID(),
  };
  const contractResult = parseContractResult(params);
  const contractRetry = parseContractRetry(params, contractResult);

  return (
    <PartShell title="Профиль">
      <div className="space-y-6">
        <ProfileCaseDirectory
          directory={directory}
          initiallyOpen={directoryParams.active || !view}
          params={directoryParams}
        />
        {view ? (
          <Profile
            profile={view.profile}
            draft={view.details}
            sales={view.sales}
            actorRole={actor.presentationRole}
            authorityRole={actor.authorityRole}
            organizationId={actor.organizationId}
            requestIds={requestIds}
            contractResult={contractResult}
            contractRetry={contractRetry}
            tab={tab}
            hrefFor={hrefFor}
          />
        ) : (
          <p className="rounded-card border border-border bg-surface px-4 py-8 text-center text-sm text-fg-3">
            {ambiguous
              ? "Профиль не открыт: укажите либо лид, либо дело студента."
              : missing
                ? "Такого человека в базе нет. Показывать вместо него другого мы не будем."
                : directoryParams.active
                  ? "Выберите точное дело студента из результатов поиска."
                  : "В базе нет ни одного человека."}
          </p>
        )}
      </div>
    </PartShell>
  );
}
