import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  allDayDate,
  applicationStatus,
  eventLabel,
  journalEventText,
  taskChangeField,
  role as roleWord,
  source as sourceWord,
} from "@/lib/v3/wording";
import { buildV3InboxHref } from "@/lib/v3/inbox-href";

import { Card } from "@/components/ui";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { caseMomentLabel } from "./case-work-view";
import { caseMoneyWords } from "@/lib/v3/wording";
import { StatusChip } from "../blocks/StatusChip";
import { CaseAgreementBlock } from "./CaseAgreementBlock";
import { CaseMoneyPanel, CaseMoneySection } from "./CaseMoney";
import { CASE_MONEY_PANEL, moneyMomentDay } from "./case-money-view";
import { moneyPanelPlan } from "./money-panels";
import { AnketaNext } from "./next/tabs/AnketaNext";
import { HistoryNext } from "./next/tabs/HistoryNext";
import { MoneyNext } from "./next/tabs/MoneyNext";
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
import { HandoffGateForms, HandoffStripBlock, ProfileHandoffAcknowledgement, ProfileSalesHandoffAcknowledgement, ProfileSalesTransition } from "./ProfileSalesTransition";
import { EditGroup } from "./EditGroup";
import { leadGroupSummaries } from "./lead-work-view";
import { LeadSaleConditions } from "./LeadSaleConditions";
import { LeadConditionsCard, LeadEducationCard, LeadWishesCard, SaleConditionsRevisionProvider } from "./LeadCardFieldsForm";
import { PrepareLeadCabinetAction } from "./PrepareLeadCabinetAction";
import { handoffStripView } from "./handoff-strip-view";
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
    return <p className="px-4 py-3 text-sm text-fg-3">Не заполнено.</p>;
  }
  return (
    <dl>
      {shown.map((fact) => (
        <div
          key={fact.label}
          className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
        >
          <dt className="t-caption w-40 shrink-0 text-fg-3">{fact.label}</dt>
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
export function PlatformAccessCard({ application, requestId, readOnly, leadId, leadCabinetCase, prepareRequestId, caseLink = true, bare = false, children }: {
  application: StudentApplication | null; requestId: string; readOnly: boolean;
  /** «Подготовить кабинет» (unified workflow S7): for a lead with no анкета and no linked case. */
  leadId: string | null; leadCabinetCase: LeadCabinetCase | null; prepareRequestId: string;
  /** «Открыть дело» — только тому, кто открывает дела (без `admissions.read` ссылка вела бы в пустоту). */
  caseLink?: boolean;
  /** Lead 360 (Э4): группа «Доступ к порталу» без своей карточки — заголовок у раскрытия. */
  bare?: boolean;
  children?: ReactNode;
}) {
  const body = (
    <>
      <div className={bare ? "space-y-3" : "space-y-3 px-4 py-3"}>
        {application === null && leadCabinetCase !== null ? (
          <p className="text-sm text-fg-2">
            {leadCabinetCase.state === "closed" ? "Дело закрыто." : "Дело уже создано."}
            {caseLink ? <>{" "}<Link className="text-fg underline underline-offset-4 hover:text-fg-2" href={`/v3/profile?case=${encodeURIComponent(leadCabinetCase.studentCaseId)}&tab=anketa`}>
              Открыть дело
            </Link></> : null}
          </p>
        ) : application === null ? (readOnly || leadId === null ? (
          <p className="text-sm text-fg-2">Заявка на доступ не заполнена. Подготовка кабинета недоступна в этом режиме.</p>
        ) : (
          <PrepareLeadCabinetAction leadId={leadId} requestId={prepareRequestId} caseLink={caseLink} quiet />
        )) : application.status === "approved" ? (
          <p className="text-sm text-fg-2">
            Заявка на доступ одобрена.{" "}
            {application.studentCaseId ? (
              <Link className="text-fg underline underline-offset-4 hover:text-fg-2" href={`/v3/profile?case=${encodeURIComponent(application.studentCaseId)}&tab=anketa`}>
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
            <ApplicationDecision application={application} requestId={requestId} quiet />
          </>
        )}
      </div>
      {children ? <div className={bare ? "mt-3 border-t border-border" : "border-t border-border"}>{children}</div> : null}
    </>
  );
  return bare ? body : <Card title="Доступ к порталу" id="portal-access">{body}</Card>;
}

/**
 * Card ↔ chat link (plan §4/§12): only when a linked conversation already
 * exists, and only for actors who can actually open Inbox (`messaging.read` —
 * the route's own gate, symmetric with v3InboxProfileHref's reverse-direction
 * check on the inbox page). The lead read already carries this (see types.ts).
 */
function LinkedConversationLinks({ sales, actor, className }: {
  sales: ProfileSalesSnapshot;
  actor: ActivePlatformActor;
  className: string;
}) {
  if (sales.linkedConversations.length === 0 || !staffPresentationCan(actor, "messaging.read")) return null;
  return (
    <div className={className}>
      {sales.linkedConversations.map((conversation) => (
        <Link
          key={conversation.conversationId}
          href={buildV3InboxHref({
            conversationId: conversation.conversationId,
            filters: { query: null, sort: "newest" },
          })}
          className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg"
        >
          {sales.linkedConversations.length > 1
            ? `Открыть переписку WhatsApp — ${conversation.subject}`
            : "Открыть переписку WhatsApp"}
        </Link>
      ))}
    </div>
  );
}

/**
 * Продажа на карточке: менеджер и действие продаж, проверка договора и
 * первого платежа («Договор и оплата») и четыре блока условий продажи. Одна
 * часть для обоих видов: на карточке лида — в «Обзоре» как раньше, на деле
 * студента — в свёрнутом разделе «Данные продажи» (решение владельца 26.09).
 * `quiet` — «Сохранить» четырёх блоков условий спокойные кнопки, сплошной
 * красный остаётся одному главному действию страницы. `groups` (дело) —
 * те же группы, что у Lead 360, вместо карточки «Продажи»: менеджер и шаг
 * продаж стоят в «Сведениях» дела.
 */
export function SalesOverview({
  profile,
  sales,
  draft,
  actor,
  requestIds,
  quiet = false,
  groups = false,
}: {
  profile: PersonProfile;
  sales: ProfileSalesSnapshot;
  draft: ProfileDraft;
  actor: ActivePlatformActor;
  requestIds: ProfileSalesRequestIds;
  quiet?: boolean;
  groups?: boolean;
}) {
  // Этап — по одному правилу доски (Э2, 26.09.2026): переданный лид —
  // «Переданы», закрытый — не рабочий. Без чтения полосы этапа не показываем:
  // сырой stage_key мог бы снова сказать «Новый» про переданного лида.
  const strip = sales.strip.status === "available"
    ? handoffStripView(sales.strip.strip, { now: new Date() })
    : null;
  const saleConditionsReadOnly = isStaffPreview(actor) || !staffHasPermission(actor, "lead.sales.workflow.manage");
  if (groups) {
    // Дело студента: те же группы и названия, что у Lead 360 («Данные лида»), по одной. Менеджер и шаг продаж —
    // в «Сведениях» дела, поэтому отдельной карточки «Продажи» нет; переписка WhatsApp лида осталась ссылкой здесь.
    const conditions = draft.saleConditions;
    const summaries = conditions ? leadGroupSummaries(conditions) : null;
    return (
      <div className="min-w-0 ps-3" data-testid="v3-sales-groups">
        <LinkedConversationLinks sales={sales} actor={actor} className="flex flex-col gap-1 border-b border-border" />
        <EditGroup title="Передача" summary={null} testId="v3-case-group-handoff">
          <HandoffStripBlock gate={sales.gate} view={strip} className="space-y-3" />
          <HandoffGateForms actor={actor} gate={sales.gate} requestIds={requestIds} bare />
        </EditGroup>
        {conditions && summaries ? (
          <SaleConditionsRevisionProvider initialRevision={conditions.revision}>
            <EditGroup id="sale-conditions" title="Условия продажи" summary={summaries.sale} testId="v3-case-group-sale">
              <LeadSaleConditions leadId={conditions.leadId} conditions={conditions} requestId={requestIds.saleConditions}
                readOnly={saleConditionsReadOnly} quiet bare />
            </EditGroup>
            <EditGroup title="Пожелания" summary={summaries.wishes} testId="v3-case-group-wishes">
              <LeadWishesCard leadId={conditions.leadId} conditions={conditions} requestId={requestIds.wishesCard}
                readOnly={saleConditionsReadOnly} quiet bare />
            </EditGroup>
            <EditGroup title="Образование" summary={summaries.education} testId="v3-case-group-education">
              <LeadEducationCard leadId={conditions.leadId} conditions={conditions} requestId={requestIds.educationCard}
                readOnly={saleConditionsReadOnly} quiet bare />
            </EditGroup>
            <EditGroup title="Бюджет и ограничения" summary={summaries.conditions} testId="v3-case-group-conditions">
              <LeadConditionsCard leadId={conditions.leadId} conditions={conditions} requestId={requestIds.conditionsCard}
                readOnly={saleConditionsReadOnly} quiet bare />
            </EditGroup>
          </SaleConditionsRevisionProvider>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <Card
        eyebrow
        title="Продажи"
        aside={strip ? <Pill tone="neutral"><span data-testid="v3-lead-stage">{strip.stageTitle}</span></Pill> : undefined}
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
        {/* Card ↔ chat link (plan §4/§12): см. LinkedConversationLinks. */}
        <LinkedConversationLinks sales={sales} actor={actor} className="flex flex-col gap-1 border-t border-border px-4 py-2.5" />
      </Card>

      <ProfileSalesTransition
        actor={actor}
        gate={sales.gate}
        view={strip}
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
            quiet={quiet}
          />
          <LeadWishesCard
            leadId={draft.saleConditions.leadId}
            conditions={draft.saleConditions}
            requestId={requestIds.wishesCard}
            readOnly={saleConditionsReadOnly}
            quiet={quiet}
          />
          <LeadEducationCard
            leadId={draft.saleConditions.leadId}
            conditions={draft.saleConditions}
            requestId={requestIds.educationCard}
            readOnly={saleConditionsReadOnly}
            quiet={quiet}
          />
          <LeadConditionsCard
            leadId={draft.saleConditions.leadId}
            conditions={draft.saleConditions}
            requestId={requestIds.conditionsCard}
            readOnly={saleConditionsReadOnly}
            quiet={quiet}
          />
        </SaleConditionsRevisionProvider>
      ) : null}
    </>
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
        <SalesOverview profile={profile} sales={sales} draft={draft} actor={actor} requestIds={requestIds} quiet />
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
        <span className="t-caption text-fg-3">Оплата</span>
        <span className="t-figure text-fg">
          {draft.paidPercent === null ? "—" : draft.paidPercent}
          {draft.paidPercent === null ? null : (
            <span className="text-sm font-normal text-fg-3">%</span>
          )}
        </span>
        <span className="t-meta text-fg-3">
          {profile.financeStop
            ? `финансовый стоп: ${profile.financeStop}`
            : draft.remaining
              ? `остаток ${draft.remaining}`
              : "плана платежей нет"}
        </span>
      </a> : null}

      {draft.admissions ? (
        <ProfileAdmissionsWorkspacePanel actor={actor} workspace={draft.admissions} nowIso={new Date().toISOString()} />
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
              <p className="t-meta px-4 pb-3 pt-0.5 text-fg-3">
                {application.institution} · набор {application.intake}
                {application.universityDeadlineOn
                  ? ` · срок подачи ${allDayDate(application.universityDeadlineOn) ?? "не указан"}`
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

export function Anketa({ profile, draft, fieldsRequestId, fieldsReadOnly, documentsHref, routeHref = null, nextUi = false }: {
  profile: PersonProfile; draft: ProfileDraft;
  fieldsRequestId: string; fieldsReadOnly: boolean; documentsHref: string | null;
  routeHref?: string | null;
  /** «Новый вид»: те же данные в карточках набора (`AnketaNext`); без признака разметка прежняя. */
  nextUi?: boolean;
}) {
  if (nextUi) return <AnketaNext profile={profile} draft={draft} fieldsRequestId={fieldsRequestId} fieldsReadOnly={fieldsReadOnly} documentsHref={documentsHref} routeHref={routeHref} />;
  // Пустые карточки не рисуются: одна строка вместо двух «ничего не заполнено».
  // Интересующее направление лида без дела стоит в «Сведениях» Lead 360, не здесь.
  const personShown = [profile.phone, profile.email].some(Boolean) || draft.person.some((fact) => fact.value !== null);
  const studyShown = draft.study.some((fact) => fact.value !== null) || (profile.student && profile.leadId !== null);
  const caseFacts = !personShown && !studyShown && !profile.qualification ? (
    <p className="t-body-compact text-fg-2">Других сведений нет.</p>
  ) : (
    <div className="grid gap-4 @4xl:grid-cols-2">
      {personShown ? (
        <Card eyebrow title="Человек">
          {/* Телефон и почта — настоящие: они единственные, что модель знает про
              человека кроме имени. Поэтому без пунктира.
              Обёртки <dl> здесь нет: FactList рисует свой, и вложенный список
              определений — невалидная разметка. */}
          <FactList
            facts={[
              { label: "Телефон", value: profile.phone },
              { label: "Почта", value: profile.email },
              ...draft.person,
            ]}
          />
        </Card>
      ) : null}

      {studyShown ? (
        <Card eyebrow title="Учёба и планы">
          {profile.student && profile.leadId ? <LeadInterestSummary leadId={profile.leadId} /> : null}
          {draft.study.some((fact) => fact.value !== null) ? <FactList facts={draft.study} /> : null}
        </Card>
      ) : null}

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
      readOnly={fieldsReadOnly} sourceVersions={draft.profileFieldSources} documentsHref={documentsHref} routeHref={routeHref} />
    <StaffDisclosure label="Другие сведения дела" buttonClassName="font-semibold">
      <div className="pt-3">{caseFacts}</div>
    </StaffDisclosure>
  </div>;
}

/* ----------------------------------------------------------------- Деньги */

/**
 * «Договор и оплата» (Э8.3, PLAN_CHANGES 28.09): один лист — сводка строками
 * (стоимость · договор · оплачено · остаток · финансовый стоп), под ней
 * транши и оплаты. Редкое — панели «⋯» заголовка: подготовка договора по
 * шаблону и служебные сведения (из `contractWorkspace`), обязательства,
 * стопы и дополнительные операции. Права прежние: сводка — чтение 189,
 * обязательства и стопы — только прочитанный финансовый контроль дела,
 * раздел договора — его собственный доступ (у роли продаж его нет).
 * Тот же компонент — на странице лида (`salesCaseId`).
 */
export function Money({
  profile,
  draft,
  actor,
  salesCaseId,
  saleConditionsHref,
  financeVisible,
  contractWorkspace,
  nextUi = false,
}: {
  profile: PersonProfile;
  draft: ProfileDraft;
  actor: ActivePlatformActor;
  salesCaseId?: string | null;
  saleConditionsHref: string | null;
  financeVisible: boolean;
  contractWorkspace: React.ReactNode;
  /** «Новый вид»: лист - набор карточек (`MoneyNext`); права, чтения и панели те же. */
  nextUi?: boolean;
}) {
  if (nextUi) return <MoneyNext {...{ profile, draft, actor, salesCaseId, saleConditionsHref, financeVisible, contractWorkspace }} />;
  const { financeCaseId, contractCaseId, finance, operations, panels } = moneyPanelPlan({
    draft, actor, salesCaseId, financeVisible, contractWorkspace: Boolean(contractWorkspace),
  });
  const words = caseMoneyWords.panels;
  const today = dayInOrganizationTimezone(new Date());

  return (
    <CaseMoneySection panels={panels} contractCaseId={contractCaseId}>
      {!financeVisible ? (
        <p className="py-3 t-body-compact text-fg-2">{caseMoneyWords.financeHidden}</p>
      ) : financeCaseId ? (
        <CaseAgreementBlock
          actor={actor}
          studentCaseId={financeCaseId}
          saleConditionsHref={saleConditionsHref}
          financeStop={profile.financeStop}
          stopsPanel={finance !== null}
        />
      ) : (
        <p className="py-3 t-body-compact text-fg-2">{caseMoneyWords.noCase}</p>
      )}

      {contractWorkspace}

      {finance ? (
        <CaseMoneyPanel id={CASE_MONEY_PANEL.obligations} label={words.obligations}>
          <p className="t-body-compact text-fg-2">
            Услуги EVO и другие расходы по делу.
            {draft.budget ? <> Всего <span className="tabular-nums text-fg">{draft.budget}</span>
              {draft.paid ? <> · оплачено <span className="tabular-nums text-fg">{draft.paid}</span></> : null}
              {draft.remaining ? <> · остаток <span className="tabular-nums text-fg">{draft.remaining}</span></> : null}</> : null}
          </p>
          <ul className="mt-2 border-t border-border">
            {draft.payments.map((payment) => (
              <li key={payment.name} className="flex min-h-11 flex-wrap items-center gap-x-4 border-b border-border py-1.5">
                <span className="min-w-0 flex-1 break-words t-body-compact text-fg">{payment.name}</span>
                <span className="t-body-compact tabular-nums text-fg">{payment.amount}</span>
                <span className="t-meta text-fg-2">
                  {payment.at ? <>{payment.state === "paid" ? "оплачен" : "до"}{" "}
                    <time dateTime={payment.at} className="font-mono tabular-nums">{moneyMomentDay(payment.at, today)}</time></>
                    : payment.state === "paid" ? "оплачен" : null}
                </span>
                {payment.state === "overdue" ? <StatusChip label="просрочен" tone="danger" /> : null}
              </li>
            ))}
            {draft.payments.length === 0 ? (
              <li className="border-b border-border py-2.5 t-body-compact text-fg-2">Обязательств пока нет.</li>
            ) : null}
          </ul>
        </CaseMoneyPanel>
      ) : null}

      {finance ? (
        <CaseMoneyPanel id={CASE_MONEY_PANEL.stops} label={words.stops}>
          <ProfileFinanceControls actor={actor} workspace={finance} />
        </CaseMoneyPanel>
      ) : null}
      {operations && financeCaseId ? (
        <CaseMoneyPanel id={CASE_MONEY_PANEL.operations} label={words.operations}>
          <FinanceEntryWorkspace caseId={financeCaseId} />
        </CaseMoneyPanel>
      ) : null}
    </CaseMoneySection>
  );
}

/* --------------------------------------------------------------- История */

export function History({ profile, nextUi = false }: { profile: PersonProfile; /** «Новый вид»: `HistoryNext`. */ nextUi?: boolean }) {
  if (nextUi) return <HistoryNext profile={profile} />;
  const today = dayInOrganizationTimezone(new Date());
  return (
    <div className="grid gap-4 @4xl:grid-cols-2">
      <Card eyebrow title="Что происходило">
        <ol>
          {profile.timeline.map((entry) => {
            const label = journalEventText(entry.transition, entry.directionChange) ?? eventLabel(entry.transition);
            // Неизвестное событие пропускается: сырой ключ на экране — это
            // ровно то, что мы убирали.
            if (!label) return null;
            // Момент — как в «Ленте» на «Обзоре» («18.10 02:39»); без ISO — готовая подпись журнала.
            const moment = entry.occurredAt && Number.isFinite(Date.parse(entry.occurredAt))
              ? caseMomentLabel(entry.occurredAt, today) : entry.at;
            return (
              <li key={entry.id} className="border-b border-border px-4 py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  {entry.href ? (
                    <Link href={entry.href} className="inline-flex min-h-11 min-w-0 items-center text-sm text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">{label}</Link>
                  ) : <span className="min-w-0 text-sm text-fg">{label}</span>}
                  {moment ? <span className="t-meta font-mono tabular-nums text-fg-3">{moment}</span> : null}
                </div>
                {entry.changedFields?.length ? (
                  <p className="mt-1 text-xs text-fg-3">Изменено: {[...new Set(entry.changedFields.map(taskChangeField).filter(Boolean))].join(", ")}.</p>
                ) : null}
                {roleWord(entry.role) ? (
                  <p className="t-meta mt-0.5 text-fg-3">{roleWord(entry.role)}</p>
                ) : null}
              </li>
            );
          })}
          {profile.timelineForbidden ? (
            <li className="px-4 py-3 text-sm text-fg-2" data-testid="v3-history-forbidden">Нет доступа к журналу этого дела.</li>
          ) : profile.timeline.length === 0 ? (
            <li className="px-4 py-3 text-sm text-fg-3">Событий нет.</li>
          ) : null}
        </ol>
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
      <Card eyebrow title="Источник">
        <FactList
          facts={[
            { label: "Откуда", value: sourceWord(profile.source) ?? "Не известно" },
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
