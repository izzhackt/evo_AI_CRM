import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  allDayDate,
  applicationStatus,
  eventLabel,
  leadStage,
  role as roleWord,
  source as sourceWord,
  visaKind,
  visaStatus,
} from "@/lib/v3/wording";

import { Card } from "./Card";
import {
  ProfileAdmissionsWorkspacePanel,
  ProfileFinanceControls,
} from "./ProfileAdmissionsWorkspace";
import { ProfileSalesTransition } from "./ProfileSalesTransition";
import type {
  Fact,
  PersonProfile,
  ProfileActorRole,
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
  actorRole,
  requestIds,
  tabHref,
}: {
  profile: PersonProfile;
  draft: ProfileDraft;
  sales: ProfileSalesSnapshot | null;
  actorRole: ProfileActorRole;
  requestIds: ProfileSalesRequestIds;
  tabHref: (tab: string) => string;
}) {
  const application = profile.applications.find((candidate) => candidate.isPrimary) ?? null;
  const stage = sales ? leadStage(sales.lead.stageKey) : null;

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
      {sales && actorRole !== "admissions" ? (
        <>
          <Card
            title="Sales"
            aside={stage ? <Pill tone="neutral">{stage}</Pill> : undefined}
          >
            <FactList
              facts={[
                {
                  label: "Ответственный",
                  value: sales.lead.currentOwnerDisplayName ?? "не назначен",
                },
                {
                  label: "Следующее действие",
                  value: sales.lead.nextActionText ?? "не назначено",
                },
                { label: "Срок", value: profile.nextActionAt },
              ]}
            />
          </Card>

          <ProfileSalesTransition
            actorRole={actorRole}
            gate={sales.gate}
            handoff={sales.handoff}
            requestIds={requestIds}
          />
        </>
      ) : null}

      <a
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
      </a>

      {draft.admissions ? (
        <ProfileAdmissionsWorkspacePanel actorRole={actorRole} workspace={draft.admissions} />
      ) : (
        <Card title="Заявка">
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

      <Card title="Коротко">
        <FactList
          facts={[
            { label: "Ответственный", value: draft.responsible },
            { label: "Поставщик услуг", value: draft.provider },
            ...draft.study.slice(0, 2),
          ]}
        />
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- Анкета */

export function Anketa({ profile, draft }: { profile: PersonProfile; draft: ProfileDraft }) {
  return (
    <div className="grid gap-4 @4xl:grid-cols-2">
      <Card title="Человек">
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

      <Card title="Учёба и планы">
        <FactList facts={draft.study} />
      </Card>

      {profile.qualification ? (
        <div className="lg:col-span-2">
          <Card title="Что выяснили при квалификации">
            <p className="px-4 py-3 text-sm leading-6 text-fg">{profile.qualification}</p>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Деньги */

const PAY_TONE: Record<string, PillTone> = { paid: "ok", due: "warn", overdue: "danger" };

export function Money({
  profile,
  draft,
  actorRole,
}: {
  profile: PersonProfile;
  draft: ProfileDraft;
  actorRole: ProfileActorRole;
}) {
  return (
    <div className="flex flex-col gap-4">
      {profile.financeStop ? (
        <p className="v3-edge-danger flex flex-wrap items-start gap-2 rounded-card border border-border border-s-2 bg-surface px-4 py-3 text-sm leading-5 text-fg">
          <Pill tone="danger">финансовый стоп</Pill>
          <span className="min-w-0 flex-1">{profile.financeStop}</span>
        </p>
      ) : null}

      <Card title="Бюджет">
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

      <Card title="План платежей">
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

      <ProfileFinanceControls actorRole={actorRole} workspace={draft.admissions} />

      <Card title="Договор">
        <FactList
          facts={[
            {
              label: "Подписан",
              value: profile.handoff
                ? `${profile.handoff.at} · договор и первый платёж подтверждены`
                : null,
            },
          ]}
        />
        {profile.handoff ? null : (
          <p className="px-4 py-3 text-sm text-fg-3">Договор ещё не подтверждён.</p>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- История */

export function History({ profile }: { profile: PersonProfile }) {
  return (
    <div className="grid gap-4 @4xl:grid-cols-2">
      <Card title="Что происходило">
        <div
          role="group"
          aria-label="История изменений"
          tabIndex={0}
          className="max-h-[560px] overflow-y-auto"
        >
          <ol>
            {profile.timeline.map((entry) => {
              const label = eventLabel(entry.transition);
              // Неизвестное событие пропускается: сырой ключ на экране — это
              // ровно то, что мы убирали.
              if (!label) return null;
              return (
                <li key={entry.id} className="border-b border-border px-4 py-2.5 last:border-b-0">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 text-sm text-fg">{label}</span>
                    <span className="shrink-0 font-mono text-2xs text-fg-3">{entry.at}</span>
                  </p>
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
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Как он к нам пришёл">
          <FactList
            facts={[
              { label: "Откуда", value: sourceWord(profile.source) ?? "неизвестно" },
              { label: "Появился", value: profile.arrived },
              {
                label: "Передан",
                value: profile.handoff
                  ? profile.handoff.override
                    ? `${profile.handoff.at} · в обход гейта`
                    : profile.handoff.at
                  : null,
              },
            ]}
          />
        </Card>

        {profile.student && profile.visa.length > 0 ? (
          <Card title="Виза">
            <ol>
              {profile.visa.map((milestone, index) => (
                <li
                  key={milestone.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border-strong font-mono text-2xs text-fg-3"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-fg">
                    {visaKind(milestone.kind) ?? milestone.kind}
                  </span>
                  <Pill tone={tone(milestone.status)}>{visaStatus(milestone.status) ?? "—"}</Pill>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
