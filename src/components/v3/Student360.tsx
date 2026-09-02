import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  applicationStatus,
  eventLabel,
  personState,
  role as roleWord,
  visaKind,
  visaStatus,
} from "@/lib/v3/wording";

/**
 * Досье человека.
 *
 * Порядок блоков — по тому, что мешает делу. Сначала то, что остановило работу
 * (финансовый стоп), потом что дальше, потом заявка и виза, и только потом
 * история.
 *
 * ЧТО УБРАНО ИЗ ШАПКИ И ПОЧЕМУ. Здесь стояли четыре пилюли: `active`,
 * `handed_off`, `admissions`, `referral`, и ссылка в старый интерфейс.
 * Осталась одна строка состояния. Разбор:
 *
 * - `active` — статус кейса. Одинаков у всех и ничего не добавляет: что с
 *   человеком, видно по тому, что в досье происходит.
 * - `admissions` — роль-владелец. Роль не описывает человека, она про то, кто
 *   ведёт. Ей место рядом с работой, а не под именем.
 * - `handed_off` — стадия лида. Настоящий сигнал, но машинное слово; теперь
 *   входит в строку состояния по-русски.
 * - `referral` — источник. Полезен, но не в шапке досье.
 * - «Lead 360» — ссылка вела в старый V2, то есть из нового мира в старый.
 *
 * Все поля остаются в модели и приходят сюда: убрано только то, что рисуется.
 * См. docs/design/v3/frontend-rules.md.
 */

export type StudentApplication = Readonly<{
  id: string;
  institution: string;
  program: string;
  intake: string;
  status: string;
  nextAction: string | null;
  nextActionAt: string | null;
}>;

export type VisaMilestone = Readonly<{
  id: string;
  kind: string;
  status: string;
  due: string | null;
  blockedReason: string | null;
}>;

export type TimelineEntry = Readonly<{
  id: string;
  transition: string;
  from: string | null;
  to: string | null;
  role: string;
  at: string;
  objectType: string;
}>;

export type StudentCase = Readonly<{
  id: string;
  person: string;
  email: string | null;
  phone: string | null;
  status: string;
  /** Есть в модели, намеренно не рисуется — см. шапку файла. */
  ownerRole: string;
  nextAction: string | null;
  nextActionAt: string | null;
  /** Есть в модели, намеренно не рисуется — см. шапку файла. */
  source: string | null;
  stage: string | null;
  applications: readonly StudentApplication[];
  visa: readonly VisaMilestone[];
  /** Причина финансового стопа. null — стопа нет. */
  financeStop: string | null;
  timeline: readonly TimelineEntry[];
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

export function Student360({ student }: { student: StudentCase }) {
  const state = personState({
    hasCase: true,
    caseStatus: student.status,
    leadStage: student.stage,
  });

  // Шесть одинаковых пилюль подряд — это не шесть фактов, а один. Когда все
  // вехи в одном состоянии, оно называется один раз в шапке блока.
  const visaStatuses = [...new Set(student.visa.map((m) => m.status))];
  const oneVisaState = visaStatuses.length === 1 ? visaStatus(visaStatuses[0]) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-xl font-semibold tracking-[-0.02em] text-fg">
          {student.person}
        </h2>
        <p className="text-sm text-fg-3">{state}</p>
      </header>

      {/* Стоп — самое важное на экране, но заливать им полосу во всю ширину
          нельзя: в этом мире цвет живёт в пилюлях. Вес даёт левое ребро. */}
      {student.financeStop ? (
        <p className="flex flex-wrap items-start gap-2 rounded-card border border-border border-s-2 border-s-danger bg-surface px-4 py-3 text-sm leading-5 text-fg">
          <Pill tone="danger">финансовый стоп</Pill>
          <span className="min-w-0 flex-1">{student.financeStop}</span>
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Что дальше">
            {student.nextAction ? (
              <p className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-fg">
                {student.nextAction}
                {student.nextActionAt ? <Pill tone="warn">{student.nextActionAt}</Pill> : null}
              </p>
            ) : (
              <p className="px-4 py-3 text-sm text-fg-3">
                Следующее действие по кейсу не назначено.
              </p>
            )}
          </Section>

          <Section title="Заявки в вузы">
            <ul>
              {student.applications.map((application) => {
                const status = applicationStatus(application.status);
                return (
                  <li key={application.id} className="border-b border-border px-4 py-3 last:border-b-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-fg">{application.program}</span>
                      {status ? <Pill tone={tone(application.status)}>{status}</Pill> : null}
                    </p>
                    {/* Набор — часть подписи заявки, а не отдельный статус:
                        пилюлей он притворялся бы состоянием. */}
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
              {student.applications.length === 0 ? (
                <li className="px-4 py-3 text-sm text-fg-3">Заявок нет.</li>
              ) : null}
            </ul>
          </Section>

          <Section
            title="Виза"
            aside={oneVisaState ? `ни одна веха не начата — ${oneVisaState}` : null}
          >
            <ol>
              {student.visa.map((milestone, index) => (
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
                  {/* Пилюля только там, где состояние отличается от общего. */}
                  {oneVisaState ? null : (
                    <Pill tone={tone(milestone.status)}>
                      {visaStatus(milestone.status) ?? "—"}
                    </Pill>
                  )}
                </li>
              ))}
              {student.visa.length === 0 ? (
                <li className="px-4 py-3 text-sm text-fg-3">Визовых вех нет.</li>
              ) : null}
            </ol>
          </Section>
        </div>

        <Section title="История">
          {/* Прокручиваемая область — отдельный div: `role="group"` прямо на
              <ol> стирает у него роль списка, и все его <li> остаются без
              родителя. Прокрутке нужны tabIndex и имя, списку — его роль. */}
          <div
            role="group"
            aria-label="История изменений"
            tabIndex={0}
            className="max-h-[560px] overflow-y-auto"
          >
            <ol>
              {student.timeline.map((entry) => {
                const label = eventLabel(entry.transition);
                // Неизвестное событие пропускается целиком. Показать вместо
                // него сырой ключ значило бы вернуть ровно то, что убрали.
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
              {student.timeline.length === 0 ? (
                <li className="px-4 py-3 text-sm text-fg-3">Событий нет.</li>
              ) : null}
            </ol>
          </div>
        </Section>
      </div>
    </div>
  );
}
