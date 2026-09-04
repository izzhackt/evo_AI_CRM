import { randomUUID } from "node:crypto";

import { PartShell } from "@/components/v3/PartShell";
import { Profile } from "@/components/v3/profile/Profile";
import {
  buildV3ProfileHref,
  resolveTab,
  type ProfileRouteTarget,
} from "@/components/v3/profile/types";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { readProfilePicks, readProfileTarget } from "@/lib/v3/profile-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Профиль" };

export default async function ProfilePart({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; case?: string; tab?: string }>;
}) {
  const actor = await requirePlatformStaffActor();
  const [params, picks] = await Promise.all([
    searchParams,
    readProfilePicks(actor),
  ]);

  // Lead and Student Case are different canonical identities. A requested
  // value is never substituted with the first picker row, and the two query
  // parameters are never interpreted as each other.
  const hasLeadParam = params.id !== undefined;
  const hasCaseParam = params.case !== undefined;
  const explicitTarget: ProfileRouteTarget | null = params.id && !hasCaseParam
    ? { leadId: params.id, studentCaseId: null }
    : params.case && !hasLeadParam
      ? { leadId: null, studentCaseId: params.case }
      : null;
  const hasExplicitTarget = hasLeadParam || hasCaseParam;
  const target = hasExplicitTarget ? explicitTarget : picks[0]?.target ?? null;
  const view = target ? await readProfileTarget(actor, target) : null;
  const missing = hasExplicitTarget && !view;
  const ambiguous = hasLeadParam && hasCaseParam;
  // Вкладка приходит адресом, поэтому её нельзя брать на веру: чужое слово и
  // вкладка, которой у этого человека нет (`?tab=documents` у лида), открывают
  // обзор.
  const tab = resolveTab(params.tab, Boolean(view?.profile.student));
  const hrefFor = (next: string) => view
    ? buildV3ProfileHref(view.details.routeTarget, next)
    : "/v3/profile";
  const requestIds = {
    contract: randomUUID(),
    firstPayment: randomUUID(),
    override: randomUUID(),
    handoff: randomUUID(),
  };

  return (
    <PartShell title="Профиль">
      {view ? (
        <Profile
          profile={view.profile}
          draft={view.details}
          sales={view.sales}
          actorRole={actor.presentationRole}
          requestIds={requestIds}
          tab={tab}
          hrefFor={hrefFor}
        />
      ) : (
        <p className="rounded-card border border-border bg-surface px-4 py-8 text-center text-sm text-fg-3">
          {ambiguous
            ? "Профиль не открыт: укажите либо лид, либо дело студента."
            : missing
              ? "Такого человека в базе нет. Показывать вместо него другого мы не будем."
            : "В базе нет ни одного человека."}
        </p>
      )}
    </PartShell>
  );
}
