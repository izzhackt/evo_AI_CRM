import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { SalesAdmissionsHandoffCard } from "@/components/platform/sales/SalesAdmissionsHandoffCard";
import { SalesAdmissionsGateCard } from "@/components/platform/sales/SalesAdmissionsGateCard";
import { SalesLeadWorkflowDetail } from "@/components/platform/sales/SalesLeadWorkflowDetail";
import { PageHeader, btnGhostCls } from "@/components/ui";
import {
  getPlatformAdmissionsHandoff,
  PlatformAdmissionsHandoffRepositoryError,
} from "@/lib/platform-admissions-handoff";
import { getT, type Locale } from "@/lib/i18n";
import {
  getPlatformAdmissionsGate,
  PlatformAdmissionsGateRepositoryError,
} from "@/lib/platform-admissions-gate";
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
  const [workflowResult, ownerResult, gateResult, handoffResult, canonicalLead] = await Promise.all([
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
    getPlatformAdmissionsGate(actor, id)
      .then((gate) => ({ gate, unavailable: false as const }))
      .catch((error: unknown) => {
        if (error instanceof PlatformAdmissionsGateRepositoryError) {
          return { gate: null, unavailable: true as const };
        }
        throw error;
      }),
    getPlatformAdmissionsHandoff(actor, id)
      .then((handoff) => ({ handoff, unavailable: false as const }))
      .catch((error: unknown) => {
        if (error instanceof PlatformAdmissionsHandoffRepositoryError) {
          return { handoff: null, unavailable: true as const };
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
      {gateResult.gate ? (
        <SalesAdmissionsGateCard
          gate={gateResult.gate}
          locale={locale}
          requestIds={{
            confirmContract: randomUUID(),
            confirmFirstPayment: randomUUID(),
            overrideGate: randomUUID(),
          }}
        />
      ) : (
        <SalesAdmissionsGateUnavailable
          locale={locale}
          reason={gateResult.unavailable ? "read_failure" : "not_initialized"}
        />
      )}
      {handoffResult.handoff ? (
        <SalesAdmissionsHandoffCard
          handoff={handoffResult.handoff}
          locale={locale}
          requestId={randomUUID()}
        />
      ) : (
        <SalesAdmissionsHandoffUnavailable
          locale={locale}
          reason={handoffResult.unavailable ? "read_failure" : "not_initialized"}
        />
      )}
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

function SalesAdmissionsHandoffUnavailable({
  locale,
  reason,
}: Readonly<{
  locale: Locale;
  reason: "read_failure" | "not_initialized";
}>) {
  const copy = {
    ru: {
      title: "Передача в Admissions недоступна",
      read_failure:
        "Не удалось прочитать U6 handoff state. Это fail-closed ошибка чтения: передача не считается разрешённой.",
      not_initialized:
        "Для этого канонического лида U6 handoff state ещё не инициализирован. Пока передача не может считаться подтверждённой.",
    },
    ky: {
      title: "Admissions'ке өткөрүү жеткиликсиз",
      read_failure:
        "U6 handoff абалы окулган жок. Бул fail-closed окуу катасы: өткөрүү уруксат берилди деп эсептелбейт.",
      not_initialized:
        "Бул каноникалык лид үчүн U6 handoff абалы азырынча инициализацияланган эмес. Азырынча өткөрүү тастыкталды деп эсептелбейт.",
    },
    en: {
      title: "Admissions handoff unavailable",
      read_failure:
        "The U6 handoff state could not be read. This is a fail-closed read error, so handoff is not considered authorized.",
      not_initialized:
        "The U6 handoff state has not been initialized for this canonical lead yet. The handoff cannot be treated as confirmed.",
    },
  }[locale];

  return (
    <section
      className="rounded-card border border-danger bg-danger-weak px-5 py-4"
      data-testid={`admissions-handoff-${reason}`}
    >
      <h2 className="text-[14.5px] font-semibold text-danger">{copy.title}</h2>
      <p className="mt-1 text-[13px] leading-5 text-fg-2">{copy[reason]}</p>
    </section>
  );
}

function SalesAdmissionsGateUnavailable({
  locale,
  reason,
}: Readonly<{
  locale: Locale;
  reason: "read_failure" | "not_initialized";
}>) {
  const copy = {
    ru: {
      title: "Допуск в Admissions недоступен",
      read_failure:
        "Не удалось прочитать U5 gate. Это ошибка чтения: передача остаётся заблокированной, пока состояние не будет подтверждено.",
      not_initialized:
        "Для этого лида U5 gate не создан. Исторические лиды не подключаются автоматически; передача остаётся заблокированной.",
    },
    ky: {
      title: "Admissions бөлүмүнө өткөрүү жеткиликсиз",
      read_failure:
        "U5 gate окулган жок. Бул окуу катасы: абал ырасталмайынча өткөрүү бөгөттөлөт.",
      not_initialized:
        "Бул лид үчүн U5 gate түзүлгөн эмес. Мурунку лиддер автоматтык түрдө кошулбайт; өткөрүү бөгөттөлөт.",
    },
    en: {
      title: "Admissions handoff gate unavailable",
      read_failure:
        "The U5 gate could not be read. This is a read failure; handoff remains blocked until the state can be verified.",
      not_initialized:
        "This lead has no U5 gate. Historical leads are not enrolled automatically; handoff remains blocked.",
    },
  }[locale];

  return (
    <section
      className="rounded-card border border-danger bg-danger-weak px-5 py-4"
      data-testid={`admissions-gate-${reason}`}
    >
      <h2 className="text-[14.5px] font-semibold text-danger">{copy.title}</h2>
      <p className="mt-1 text-[13px] leading-5 text-fg-2">{copy[reason]}</p>
    </section>
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
