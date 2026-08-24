import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { SalesLeadWorkflowDetail } from "@/components/platform/sales/SalesLeadWorkflowDetail";
import { PageHeader, btnGhostCls } from "@/components/ui";
import { getT, type Locale } from "@/lib/i18n";
import {
  PlatformCanonicalRecordsRepositoryError,
  getPlatformCanonicalLead,
} from "@/lib/platform-canonical-records";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  PlatformSalesWorkflowRepositoryError,
  getPlatformSalesLeadDetail,
  listPlatformSalesOwnerOptions,
} from "@/lib/platform-sales-workflow";

export async function ConnectedCanonicalLeadDetail({
  id,
}: Readonly<{ id: string }>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
  ]);
  const [workflowResult, ownerResult, canonicalLead] = await Promise.all([
    getPlatformSalesLeadDetail(actor, id)
      .then((lead) => ({ lead, unavailable: false as const }))
      .catch((error: unknown) => {
        if (error instanceof PlatformSalesWorkflowRepositoryError) {
          return { lead: null, unavailable: true as const };
        }
        throw error;
      }),
    listPlatformSalesOwnerOptions(actor, { pageSize: 50 })
      .then((page) => ({ page, unavailable: false as const }))
      .catch((error: unknown) => {
        if (error instanceof PlatformSalesWorkflowRepositoryError) {
          return { page: null, unavailable: true as const };
        }
        throw error;
      }),
    getPlatformCanonicalLead(actor, id).catch((error: unknown) => {
      if (error instanceof PlatformCanonicalRecordsRepositoryError) return null;
      throw error;
    }),
  ]);

  if (workflowResult.unavailable) {
    return <SalesLeadWorkflowDetailUnavailable locale={locale} />;
  }
  if (!workflowResult.lead) notFound();

  const ownerOptions =
    actor.platformRole === "sales"
      ? (ownerResult.page?.rows ?? []).filter(
          (option) => option.membershipId === actor.membershipId,
        )
      : ownerResult.page?.rows ?? [];

  return (
    <div className="space-y-8">
      <div data-testid={canonicalLead ? undefined : "canonical-lead-detail"}>
        <SalesLeadWorkflowDetail
          lead={workflowResult.lead}
          locale={locale}
          ownerOptions={ownerOptions}
          ownerOptionsHasNext={ownerResult.page?.hasNext ?? false}
          ownerOptionsNextCursor={ownerResult.page?.nextCursor ?? null}
          ownerSearchable={actor.platformRole === "admin"}
          ownerOptionsUnavailable={ownerResult.unavailable}
          requestId={randomUUID()}
        />
      </div>
      {canonicalLead ? (
        <section
          className="border-t border-border pt-6"
          aria-label={locale === "en" ? "Read-only canonical context" : "Канонический контекст только для чтения"}
          data-testid="sales-workflow-canonical-context"
        >
          <CanonicalLeadDetail lead={canonicalLead} locale={locale} />
        </section>
      ) : null}
    </div>
  );
}

function SalesLeadWorkflowDetailUnavailable({ locale }: Readonly<{ locale: Locale }>) {
  const copy = {
    ru: {
      title: "Карточка квалификации недоступна",
      description:
        "Не удалось прочитать U4 workflow. Это ошибка чтения, а не отсутствие лида; попробуйте обновить страницу.",
      back: "К лидам",
    },
    ky: {
      title: "Квалификация карточкасы жеткиликсиз",
      description:
        "U4 workflow окулган жок. Бул лид жок дегенди билдирбейт; баракты жаңыртып көрүңүз.",
      back: "Лиддерге",
    },
    en: {
      title: "Qualification detail unavailable",
      description:
        "The U4 workflow could not be read. This is a read failure, not a missing lead; try refreshing the page.",
      back: "Back to leads",
    },
  }[locale];

  return (
    <div className="space-y-5" data-testid="sales-workflow-detail-unavailable">
      <Link href="/sales" className={btnGhostCls}>
        {copy.back}
      </Link>
      <PageHeader title={copy.title} description={copy.description} />
    </div>
  );
}
