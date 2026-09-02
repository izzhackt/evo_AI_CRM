import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  applicationStatus,
  eventLabel,
  personState,
  role as roleWord,
  source as sourceWord,
  visaKind,
  visaStatus,
} from "@/lib/v3/wording";

/**
 * Профиль человека — один на всех.
 *
 * Лид и студент — это один человек на разных стадиях, а не две карточки.
 * Сначала он лид, потом тот же человек становится студентом; страница одна,
 * меняется то, что на ней есть.
 *
 * ЧТО МЕНЯЕТСЯ СО СТАДИЕЙ:
 *
 * - пока лид — блоков «Заявки» и «Виза» нет вовсе. Это не пустое состояние с
 *   надписью «пока ничего», а нормальная стадия: заявки ещё не существует;
 * - блок «Продажа» у лида раскрыт (это его текущая работа), а у студента
 *   свёрнут в строку «Как он к нам пришёл» — информация нужна и потом, но уже
 *   не как работа. Свёрткой служит нативный <details>: он открывается с
 *   клавиатуры без единой строки JS.
 *
 * В ШАПКЕ ОДНА СТРОКА СОСТОЯНИЯ, а не россыпь пилюль. Раньше их было четыре:
 * `active`, `handed_off`, `admissions`, `referral`. Три из них человека не
 * описывают, четвёртая — ключ из базы. Подробно:
 * docs/design/v3/frontend-rules.md.
 */

export type ProfilePick = Readonly<{ id: string; name: string; student: boolean }>;

export type ProfileApplication = Readonly<{
  id: string;
  institution: string;
  program: string;
  intake: string;
  status: string;
  nextAction: string | null;
  nextActionAt: string | null;
}>;

export type ProfileVisaMilestone = Readonly<{
  id: string;
  kind: string;
  status: string;
  due: string | null;
  blockedReason: string | null;
}>;

export type ProfileEvent = Readonly<{
  id: string;
  transition: string;
  role: string;
  at: string;
}>;

export type PersonProfile = Readonly<{
  leadId: string;
  person: string;
  email: string | null;
  phone: string | null;
  /** Стал ли он студентом: у человека появился кейс. */
  student: boolean;
  stage: string;
  caseStatus: string | null;
  source: string;
  qualification: string | null;
  arrived: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  handoff: Readonly<{ at: string; contract: boolean; payment: boolean; override: boolean }> | null;
  applications: readonly ProfileApplication[];
  visa: readonly ProfileVisaMilestone[];
  financeStop: string | null;
  timeline: readonly ProfileEvent[];
}>;

const STATUS_TONE: Record<string, PillTone> = {
  completed: "ok",
  accepted: "ok",
  submitted: "info",
  in_progress: "info",
  pending: "neutral",
  draft: "neutral",
  blocked: "danger",
  rejected: "danger",
};

const tone = (status: string): PillTone => STATUS_TONE[status] ?? "neutral";

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
        {title}
        {aside ? (
          <span className="font-normal normal-case tracking-normal text-fg-3">{aside}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-4 py-2.5 last:border-b-0">
      <dt className="w-32 shrink-0 text-2xs text-fg-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-fg">{value}</dd>
    </div>
  );
}

export function Profile({ profile }: { profile: PersonProfile }) {
  const state = personState({
    hasCase: profile.student,
    caseStatus: profile.caseStatus,
    leadStage: profile.stage,
  });

  const visaStatuses = [...new Set(profile.visa.map((m) => m.status))];
  const oneVisaState = visaStatuses.length === 1 ? visaStatus(visaStatuses[0]) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-xl font-semibold tracking-[-0.02em] text-fg">
          {profile.person}
        </h2>
        <p className="text-sm text-fg-3">{state}</p>
      </header>

      {profile.financeStop ? (
        <p className="flex flex-wrap items-start gap-2 rounded-card border border-border border-s-2 border-s-danger bg-surface px-4 py-3 text-sm leading-5 text-fg">
          <Pill tone="danger">финансовый стоп</Pill>
          <span className="min-w-0 flex-1">{profile.financeStop}</span>
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Что дальше">
            {profile.nextAction ? (
              <p className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-fg">
                {profile.nextAction}
                {profile.nextActionAt ? <Pill tone="warn">{profile.nextActionAt}</Pill> : null}
              </p>
            ) : (
              <p className="px-4 py-3 text-sm text-fg-3">Следующее действие не назначено.</p>
            )}
          </Section>

          {/* Заявки и виза существуют только у студента. У лида этих блоков
              нет вовсе — пустая рамка с надписью «пока ничего» сообщала бы о
              недоделке там, где всё идёт по плану. */}
          {profile.student ? (
            <Section title="Заявки в вузы">
              <ul>
                {profile.applications.map((application) => {
                  const status = applicationStatus(application.status);
                  return (
                    <li key={application.id} className="border-b border-border px-4 py-3 last:border-b-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-fg">{application.program}</span>
                        {status ? <Pill tone={tone(application.status)}>{status}</Pill> : null}
                      </p>
                      <p className="mt-0.5 text-2xs text-fg-3">
                        {application.institution} · набор {application.intake}
                      </p>
                      {application.nextAction ? (
                        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-2">
                          {application.nextAction}
                          {application.nextActionAt ? (
                            <Pill tone="warn">{application.nextActionAt}</Pill>
                          ) : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
                {profile.applications.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-fg-3">Заявок ещё нет.</li>
                ) : null}
              </ul>
            </Section>
          ) : null}

          {profile.student ? (
            <Section
              title="Виза"
              aside={oneVisaState}
            >
              <ol>
                {profile.visa.map((milestone, index) => (
                  <li
                    key={milestone.id}
                    className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border-strong font-mono text-2xs text-fg-3"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-fg">
                      {visaKind(milestone.kind) ?? milestone.kind}
                    </span>
                    {milestone.blockedReason ? (
                      <span className="truncate text-2xs text-danger">{milestone.blockedReason}</span>
                    ) : null}
                    {milestone.due ? <Pill>{milestone.due}</Pill> : null}
                    {oneVisaState ? null : (
                      <Pill tone={tone(milestone.status)}>{visaStatus(milestone.status) ?? "—"}</Pill>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}

          {/* Продажная часть. У лида это его текущая работа и блок раскрыт;
              у студента — то, как он к нам пришёл, и блок свёрнут. */}
          <details
            open={!profile.student}
            className="group rounded-card border border-border bg-surface"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2 hover:bg-surface-2">
              {profile.student ? "Как он к нам пришёл" : "Продажа"}
              <span
                aria-hidden="true"
                className="font-mono text-sm font-normal text-fg-3 group-open:hidden"
              >
                +
              </span>
              <span
                aria-hidden="true"
                className="hidden font-mono text-sm font-normal text-fg-3 group-open:inline"
              >
                −
              </span>
            </summary>

            <dl className="border-t border-border">
              <Fact label="Откуда пришёл" value={sourceWord(profile.source) ?? "источник неизвестен"} />
              {profile.arrived ? <Fact label="Появился" value={profile.arrived} /> : null}
              {profile.qualification ? (
                <Fact label="Что выяснили" value={profile.qualification} />
              ) : null}
              {profile.handoff ? (
                <Fact
                  label="Передан"
                  value={
                    profile.handoff.override
                      ? `${profile.handoff.at} · в обход гейта`
                      : `${profile.handoff.at} · договор и первый платёж подтверждены`
                  }
                />
              ) : null}
              {profile.phone ? <Fact label="Телефон" value={profile.phone} /> : null}
              {profile.email ? <Fact label="Почта" value={profile.email} /> : null}
            </dl>
          </details>
        </div>

        <Section title="История">
          {/* Прокручиваемая область — отдельный div: role="group" прямо на <ol>
              стирает у него роль списка. */}
          <div
            role="group"
            aria-label="История изменений"
            tabIndex={0}
            className="max-h-[560px] overflow-y-auto"
          >
            <ol>
              {profile.timeline.map((entry) => {
                const label = eventLabel(entry.transition);
                // Неизвестное событие пропускается: показать сырой ключ
                // значило бы вернуть то, что убирали.
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
        </Section>
      </div>
    </div>
  );
}
