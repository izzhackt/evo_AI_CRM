import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  allDayDate,
  applicationStatus,
  eventLabel,
  journalEvent,
  taskChangeField,
  leadStage,
  role as roleWord,
  source as sourceWord,
} from "@/lib/v3/wording";
import { buildV3InboxHref } from "@/lib/v3/inbox-href";

import { Card } from "@/components/ui";
import { CaseAgreementBlock } from "./CaseAgreementBlock";
import { CaseHelpWorkspace } from "./CaseHelpWorkspace";
import { CaseTasksPanel } from "./CaseTasksPanel";
import { FinanceEntryWorkspace } from "./FinanceEntryWorkspace";
import { LeadInterestSummary } from "./LeadInterestSummary";
import { StudentProfileFields } from "./StudentProfileFields";
import { StaffDisclosure } from "../settings/StaffDisclosure";
import { ApplicationDecision, StudentApplicationAnswers } from "../admissions/StudentApplications";
import type { StudentApplication } from "@/lib/student-application-contract";
import type { LeadCabinetCase } from "@/lib/v3/lead-cabinet-source";
import {
  ProfileAdmissionsWorkspacePanel,
  ProfileFinanceControls,
} from "./ProfileAdmissionsWorkspace";
import { ProfileHandoffAcknowledgement, ProfileSalesHandoffAcknowledgement, ProfileSalesTransition } from "./ProfileSalesTransition";
import { LeadSaleConditions } from "./LeadSaleConditions";
import { LeadConditionsCard, LeadEducationCard, LeadWishesCard, SaleConditionsRevisionProvider } from "./LeadCardFieldsForm";
import { PrepareLeadCabinetAction } from "./PrepareLeadCabinetAction";
import type {
  Fact,
  PersonProfile,
  ProfileDraft,
  ProfileSalesRequestIds,
  ProfileSalesSnapshot,
} from "./types";

/* ------------------------------------------------------------------ общее */

function FactList({ facts }: { facts: readonly Fact[] }) {
  const shown = facts.filter((f) => f.value !== null);
  if (shown.length === 0) {
    return <p className="px-4 py-3 text-sm text-fg-3">Пока ничего не заполнено.</p>;
  }
  return (
    <dl>
      {shown.map((fact) => (
        <div
          key={fact.label}
          className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
        >
          <dt className="w-40 shrink-0 text-2xs text-fg-3">{fact.label}</dt>
          <dd className="min-w-0 flex-1 text-sm text-fg">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const STATUS_TONE: Record<string, PillTone> = {
  completed: "ok", accepted: "ok", submitted: "info", in_progress: "info",
  pending: "neutral", draft: "neutral", blocked: "danger", rejected: "danger",
};
const tone = (s: string): PillTone => STATUS_TONE[s] ?? "neutral";

/**
 * «Доступ к платформе» — unified workflow S1 (plan §4): approving a platform
 * анкета never assigns a curator or direction, only opens the portal
 * cabinet. Admissions handoff stays a separate, later fact (Sales report).
 */
export function PlatformAccessCard({ application, requestId, readOnly, leadId, leadCabinetCase, prepareRequestId, children }: {
  application: StudentApplication | null; requestId: string; readOnly: boolean;
  /** «Подготовить кабинет» (unified workflow S7): for a lead with no анкета and no linked case. */
  leadId: string | null; leadCabinetCase: LeadCabinetCase | null; prepareRequestId: string;
  children?: ReactNode;
}) {
  return (
    <Card title="Доступ к порталу" id="portal-access">
      <div className="space-y-3 px-4 py-3">
        {application === null && leadCabinetCase !== null ? (
          <p className="text-sm text-fg-2">
            {leadCabinetCase.state === "closed" ? "Дело закрыто." : "Дело уже создано."}{" "}
            <Link className="font-semibold text-accent hover:underline" href={`/v3/profile?case=${encodeURIComponent(leadCabinetCase.studentCaseId)}&tab=anketa`}>
              Открыть дело
            </Link>
          </p>
        ) : application === null ? (readOnly || leadId === null ? (
          <p className="text-sm text-fg-2">Заявка на доступ не заполнена. Подготовка кабинета недоступна в этом режиме.</p>
        ) : (
          <PrepareLeadCabinetAction leadId={leadId} requestId={prepareRequestId} />
        )) : application.status === "approved" ? (
          <p className="text-sm text-fg-2">
            Заявка на доступ одобрена.{" "}
            {application.studentCaseId ? (
              <Link className="font-semibold text-accent hover:underline" href={`/v3/profile?case=${encodeURIComponent(application.studentCaseId)}&tab=anketa`}>
                Открыть дело
              </Link>
            ) : null}
          </p>
        ) : application.status === "rejected" ? (
          <div className="space-y-1">
            <p className="text-sm text-fg-2">Заявка на доступ отклонена.</p>
            {application.decisionReason ? <p className="whitespace-pre-wrap break-words text-sm text-fg-3">{application.decisionReason}</p> : null}
          </div>
        ) : readOnly ? (
          <p className="text-sm text-fg-2">Анкета ожидает решения. В режиме просмотра решения недоступны.</p>
        ) : (
          <>
            <p className="text-sm text-fg-2">Анкета ожидает решения.</p>
            <ApplicationDecision application={application} requestId={requestId} />
          </>
        )}
      </div>
      {children ? <div className="border-t border-border">{children}</div> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ Обзор */

/**
 * Обзор — не сводка всего, а маршрутизатор.
 *
 * Он отвечает на один вопрос: что с человеком сейчас и куда идти дальше.
 * Поэтому здесь нет ни списка документов, ни анкеты: повторять содержимое
 * вкладок значило бы обесценить сами вкладки.
 */
export function Overview({
  profile,
  draft,
  sales,
  actor,
  requestIds,
  tabHref,
}: {
  profile: PersonProfile;
  draft: ProfileDraft;
  sales: ProfileSalesSnapshot | null;
  actor: ActivePlatformActor;
  requestIds: ProfileSalesRequestIds;
  tabHref: (tab: string) => string;
}) {
  const application = profile.applications.find((candidate) => candidate.isPrimary) ?? null;
  const stage = sales ? leadStage(sales.lead.stageKey) : null;
  const saleConditionsReadOnly = isStaffPreview(actor) || !staffHasPermission(actor, "lead.sales.workflow.manage");

  // Плитка здесь ровно одна, и это не оплошность.
  //
  // «Документы» плиткой не показываем: пока список ведут в самой вкладке и
  // никуда не сохраняют, обзор мог бы показать только «0 из 9» — число,
  // которое никогда не меняется. А у лида и вкладки-то нет.
  //
  // Плитка «Заявка» вела на `?tab=overview` — на вкладку, где человек уже
  // стоит: нажатие не делало ничего. Карточка ниже говорит то же и больше,
  // поэтому осталась только она.
  //
  // Процент оплаты и финансовый стоп приходят из канонической finance-проекции;
  // ребро показывает только подтверждённый стоп.
  const blocked = profile.financeStop !== null;

  return (
    <div className="flex flex-col gap-4">
      {sales && staffPresentationCan(actor, "sales.read") ? (
        <>
          <Card
            eyebrow
            title="Sales"
            aside={stage ? <Pill tone="neutral">{stage}</Pill> : undefined}
          >
            <FactList
              facts={[
                {
                  label: "Менеджер продаж",
                  value: sales.lead.currentOwnerDisplayName ?? "не назначен",
                },
                {
                  label: "Следующее действие",
                  value: sales.lead.nextActionText ?? "не назначено",
                },
                { label: "Срок", value: profile.nextActionAt },
              ]}
            />
            {/*
             * Card ↔ chat link (plan §4/§12): only when a linked conversation
             * already exists, and only for actors who can actually open
             * Inbox (messaging.read — the route's own gate, symmetric with
             * v3InboxProfileHref's reverse-direction check on the inbox
             * page). The lead read already carries this (see types.ts).
             */}
            {sales.linkedConversations.length > 0 && staffPresentationCan(actor, "messaging.read") ? (
              <div className="flex flex-col gap-1 border-t border-border px-4 py-2.5">
                {sales.linkedConversations.map((conversation) => (
                  <Link
                    key={conversation.conversationId}
                    href={buildV3InboxHref({
                      conversationId: conversation.conversationId,
                      filters: { query: null, waitingOnly: false },
                    })}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline"
                  >
                    {sales.linkedConversations.length > 1
                      ? `Открыть переписку в Inbox — ${conversation.subject}`
                      : "Открыть переписку в Inbox"}
                  </Link>
                ))}
              </div>
            ) : null}
          </Card>

          <ProfileSalesTransition
            actor={actor}
            gate={sales.gate}
            requestIds={requestIds}
          />

          {draft.saleConditions ? (
            // The four blocks below share ONE revisioned row
            // (platform_private.lead_sale_conditions). They used to be keyed
            // by revision (`key={`…:${revision}`}`) so a save in any one of
            // them remounted all four via router.refresh() — which silently
            // wiped whatever draft the OTHER three had typed but not yet
            // saved. SaleConditionsRevisionProvider replaces that: mounted
            // once here, it hands every block a shared, client-side
            // expected_revision that a save bumps directly, with no refresh
            // and no remount. See its doc comment in LeadCardFieldsForm.tsx.
            <SaleConditionsRevisionProvider initialRevision={draft.saleConditions.revision}>
              <LeadSaleConditions
                leadId={draft.saleConditions.leadId}
                conditions={draft.saleConditions}
                requestId={requestIds.saleConditions}
                readOnly={saleConditionsReadOnly}
              />
              <LeadWishesCard
                leadId={draft.saleConditions.leadId}
                conditions={draft.saleConditions}
                requestId={requestIds.wishesCard}
                readOnly={saleConditionsReadOnly}
              />
              <LeadEducationCard
                leadId={draft.saleConditions.leadId}
                conditions={draft.saleConditions}
                requestId={requestIds.educationCard}
                readOnly={saleConditionsReadOnly}
              />
              <LeadConditionsCard
                leadId={draft.saleConditions.leadId}
                conditions={draft.saleConditions}
                requestId={requestIds.conditionsCard}
                readOnly={saleConditionsReadOnly}
              />
            </SaleConditionsRevisionProvider>
          ) : null}
        </>
      ) : null}

      {draft.handoffAcknowledgement ? (
        <ProfileHandoffAcknowledgement snapshot={draft.handoffAcknowledgement} />
      ) : draft.salesHandoffAcknowledgement ? (
        <ProfileSalesHandoffAcknowledgement snapshot={draft.salesHandoffAcknowledgement} />
      ) : null}

      {draft.admissions ? (
        <Link
          href={`/v3/messages?case=${draft.admissions.studentCaseId}`}
          className="flex min-h-11 items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm font-medium text-fg hover:border-control-edge"
        >
          Переписка
          <span aria-hidden="true" className="text-fg-3">→</span>
        </Link>
      ) : null}

      {draft.admissions ? (
        <Suspense fallback={<p role="status" className="text-sm text-fg-2">Загружаем задачи по делу…</p>}>
          <CaseTasksPanel actor={actor} caseId={draft.admissions.studentCaseId} caseName={profile.person} />
        </Suspense>
      ) : null}

      {draft.admissions && actor.presentationRole !== "sales" ? (
        <Suspense fallback={<p role="status" className="text-sm text-fg-2">Загружаем обращения студента…</p>}>
          <CaseHelpWorkspace actor={actor} caseId={draft.admissions.studentCaseId} />
        </Suspense>
      ) : null}

      {(!profile.student || draft.access.finance) ? <a
        href={tabHref("money")}
        className={`flex flex-col gap-0.5 rounded-card border bg-surface px-4 py-3 hover:border-control-edge ${
          blocked ? "v3-edge-danger border-border border-s-2" : "border-border"
        }`}
      >
        <span className="text-2xs font-semibold uppercase tracking-wide text-fg-3">Оплата</span>
        <span className="text-2xl font-bold leading-tight tracking-[-0.02em] text-fg">
          {draft.paidPercent === null ? "—" : draft.paidPercent}
          {draft.paidPercent === null ? null : (
            <span className="text-sm font-normal text-fg-3">%</span>
          )}
        </span>
        <span className="text-2xs text-fg-3">
          {profile.financeStop
            ? `финансовый стоп: ${profile.financeStop}`
            : draft.remaining
              ? `остаток ${draft.remaining}`
              : "плана платежей нет"}
        </span>
      </a> : null}

      {draft.admissions ? (
        <ProfileAdmissionsWorkspacePanel actor={actor} workspace={draft.admissions} />
      ) : (
        <Card eyebrow title="Заявка">
          {application ? (
            <>
              <p className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
                <span className="font-semibold text-fg">{application.program}</span>
                <Pill tone={tone(application.status)}>
                  {applicationStatus(application.status) ?? "—"}
                </Pill>
                {application.isPrimary ? <Pill tone="info">Основной вариант</Pill> : null}
              </p>
              <p className="px-4 pb-3 pt-0.5 text-2xs text-fg-3">
                {application.institution} · набор {application.intake}
                {application.universityDeadlineOn
                  ? ` · дедлайн ${allDayDate(application.universityDeadlineOn) ?? "не указан"}`
                  : ""}
              </p>
            </>
          ) : (
            <p className="px-4 py-3 text-sm text-fg-3">
              {profile.applications.length > 0
                ? "Основной вариант ещё не выбран."
                : "Заявка ещё не заведена."}
            </p>
          )}
        </Card>
      )}

      <Card eyebrow title="Коротко">
        <FactList
          facts={[
            { label: draft.admissions ? "Куратор" : "Менеджер продаж", value: draft.responsible },
            { label: "Поставщик услуг", value: draft.provider },
            ...draft.study.slice(0, 2),
          ]}
        />
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- Анкета */

export function Anketa({ profile, draft, fieldsRequestId, fieldsReadOnly, documentsHref }: {
  profile: PersonProfile; draft: ProfileDraft;
  fieldsRequestId: string; fieldsReadOnly: boolean; documentsHref: string | null;
}) {
  const caseFacts = (
    <div className="grid gap-4 @4xl:grid-cols-2">
      <Card eyebrow title="Человек">
        {/* Телефон и почта — настоящие: они единственные, что модель знает про
            человека кроме имени. Поэтому без пунктира.
            Обёртки <dl> здесь нет: FactList рисует свой, и вложенный список
            определений — невалидная разметка. */}
        <FactList
          facts={[
            { label: "Телефон", value: profile.phone },
            { label: "Почта", value: profile.email },
          ]}
        />
        <div className="border-t border-border">
          <FactList facts={draft.person} />
        </div>
      </Card>

      <Card eyebrow title="Учёба и планы">
        {profile.leadId ? <LeadInterestSummary leadId={profile.leadId} /> : null}
        <FactList facts={draft.study} />
      </Card>

      {profile.qualification ? (
        <div className="lg:col-span-2">
          <Card eyebrow title="Что выяснили при квалификации">
            <p className="px-4 py-3 text-sm leading-6 text-fg">{profile.qualification}</p>
          </Card>
        </div>
      ) : null}
    </div>
  );
  const studentAnswers = draft.studentApplication ? <StudentApplicationAnswers application={draft.studentApplication} /> : null;
  if (!draft.profileFields) return <div className="min-w-0 space-y-5">{studentAnswers}{caseFacts}</div>;
  return <div className="min-w-0 space-y-5">
    {studentAnswers}
    <StudentProfileFields key={draft.profileFields.studentCaseId} snapshot={draft.profileFields} requestId={fieldsRequestId}
      applications={profile.applications.map(({ id, institution, program }) => ({ id, institution, program }))}
      readOnly={fieldsReadOnly} sourceVersions={draft.profileFieldSources} documentsHref={documentsHref} />
    <StaffDisclosure label="Другие сведения дела" buttonClassName="font-semibold">
      <div className="pt-3">{caseFacts}</div>
    </StaffDisclosure>
  </div>;
}

/* ----------------------------------------------------------------- Деньги */

const PAY_TONE: Record<string, PillTone> = { paid: "ok", due: "warn", overdue: "danger" };

export function Money({
  profile,
  draft,
  actor,
  salesCaseId,
  saleConditionsHref,
}: {
  profile: PersonProfile;
  draft: ProfileDraft;
  actor: ActivePlatformActor;
  salesCaseId?: string | null;
  saleConditionsHref: string | null;
}) {
  const financeCaseId = draft.admissions?.studentCaseId ?? salesCaseId;
  return (
    <div className="flex flex-col gap-4">
      {/*
       * OTH-3 «Договор и оплата»: one unified block, replacing the split
       * money/contract surfaces (188_platform_case_agreement). Renders
       * first, before the admin ledger tools below — it is the card's
       * primary money surface now. Renders nothing on its own when there is
       * no case yet or the read RPC refuses (no fake empty state).
       */}
      {financeCaseId ? (
        <CaseAgreementBlock
          actor={actor}
          studentCaseId={financeCaseId}
          saleConditionsHref={saleConditionsHref}
        />
      ) : null}

      {profile.financeStop ? (
        <p className="v3-edge-danger flex flex-wrap items-start gap-2 rounded-card border border-border border-s-2 bg-surface px-4 py-3 text-sm leading-5 text-fg">
          <Pill tone="danger">финансовый стоп</Pill>
          <span className="min-w-0 flex-1">{profile.financeStop}</span>
        </p>
      ) : null}

      <Card eyebrow title="Бюджет">
        {draft.budget ? (
          <div className="px-4 py-3">
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-bold tracking-[-0.02em] text-fg">
                {draft.budget}
              </span>
              {draft.currency ? <span className="text-2xs text-fg-3">{draft.currency}</span> : null}
            </p>
            {draft.paidPercent !== null ? (
              <>
                {/* Полоса — украшение поверх чисел, которые и так написаны
                    рядом, поэтому она aria-hidden. */}
                <span
                  aria-hidden="true"
                  className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-surface-3"
                >
                  <span
                    className="block h-full bg-accent"
                    style={{ width: `${draft.paidPercent}%` }}
                  />
                </span>
                <p className="mt-1.5 text-2xs text-fg-3">
                  оплачено <span className="text-sm text-fg">{draft.paid}</span>
                  {draft.remaining ? ` · остаток ${draft.remaining}` : ""}
                </p>
              </>
            ) : null}
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-fg-3">Бюджет не указан.</p>
        )}
      </Card>

      <Card eyebrow title="План платежей">
        <ul>
          {draft.payments.map((payment) => (
            <li
              key={payment.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 text-sm text-fg">
                {payment.name}
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
                {payment.amount}
              </span>
              <Pill tone={PAY_TONE[payment.state]}>{payment.at}</Pill>
            </li>
          ))}
          {draft.payments.length === 0 ? (
            <li className="px-4 py-3 text-sm text-fg-3">Плана платежей нет.</li>
          ) : null}
        </ul>
      </Card>

      <ProfileFinanceControls actor={actor} workspace={draft.admissions} />
      {financeCaseId && (staffPresentationCan(actor, "admissions.read") || staffHasPermission(actor, "finance.event.confirm"))
        ? <FinanceEntryWorkspace caseId={financeCaseId} /> : null}
    </div>
  );
}

/* --------------------------------------------------------------- История */

export function History({ profile }: { profile: PersonProfile }) {
  return (
    <div className="grid gap-4 @4xl:grid-cols-2">
      <Card eyebrow title="Что происходило">
        <div
          role="group"
          aria-label="История изменений"
          tabIndex={0}
          className="max-h-[560px] overflow-y-auto"
        >
          <ol>
            {profile.timeline.map((entry) => {
              const label = journalEvent(entry.transition) ?? eventLabel(entry.transition);
              // Неизвестное событие пропускается: сырой ключ на экране — это
              // ровно то, что мы убирали.
              if (!label) return null;
              return (
                <li key={entry.id} className="border-b border-border px-4 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    {entry.href ? (
                      <Link href={entry.href} className="inline-flex min-h-11 min-w-0 items-center text-sm text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">{label}</Link>
                    ) : <span className="min-w-0 text-sm text-fg">{label}</span>}
                    {entry.at ? <span className="font-mono text-2xs text-fg-3">{entry.at}</span> : null}
                  </div>
                  {entry.changedFields?.length ? (
                    <p className="mt-1 text-xs text-fg-3">Изменено: {[...new Set(entry.changedFields.map(taskChangeField).filter(Boolean))].join(", ")}.</p>
                  ) : null}
                  {roleWord(entry.role) ? (
                    <p className="mt-0.5 text-2xs text-fg-3">{roleWord(entry.role)}</p>
                  ) : null}
                </li>
              );
            })}
            {profile.timeline.length === 0 ? (
              <li className="px-4 py-3 text-sm text-fg-3">Событий нет.</li>
            ) : null}
          </ol>
        </div>
        {profile.timelineOlderHref || profile.timelineLatestHref ? (
          <nav aria-label="Страницы истории" className="flex flex-wrap gap-4 border-t border-border px-4 py-2">
            {profile.timelineOlderHref ? <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={profile.timelineOlderHref}>Более ранние события</Link> : null}
            {profile.timelineLatestHref ? <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={profile.timelineLatestHref}>К последним событиям</Link> : null}
          </nav>
        ) : null}
      </Card>

      {/* Визовых вех здесь больше нет, и номеров при них тоже. Веха — это
          состояние, а не шаг инструкции, поэтому нумерация врала. Unified
          workflow S4 (plan §11): визовое дело как отдельная сущность со
          статусами убрано целиком — визовая карточка, которая раньше стояла
          рядом с «Заявками» в панели приёмной, тоже удалена, файлы остаются
          обычными документами группы «Виза». `profile.visa` остаётся в
          модели (реальное чтение `getPlatformCaseVisa`, не выдумка) и
          намеренно нигде не рисуется — ни здесь, ни в панели приёмной. */}
      <Card eyebrow title="Как он к нам пришёл">
        <FactList
          facts={[
            { label: "Откуда", value: sourceWord(profile.source) ?? "неизвестно" },
            { label: "Появился", value: profile.arrived },
            {
              label: "Передан",
              value: profile.handoff
                ? profile.handoff.override
                  ? `${profile.handoff.at} · с исключением из условий`
                  : profile.handoff.at
                : null,
            },
          ]}
        />
      </Card>
    </div>
  );
}
