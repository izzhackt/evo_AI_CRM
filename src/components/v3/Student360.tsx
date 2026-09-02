import Link from "next/link";

import { Pill, type PillTone } from "@/components/v3/Pill";

/**
 * Досье студента.
 *
 * Порядок блоков — по тому, что мешает делу. Сначала то, что остановило работу
 * (финансовый стоп), потом что делать дальше, потом заявка и виза, и только
 * потом история. Досье, которое начинается с анкеты, заставляет искать глазами
 * то единственное, ради чего его открыли.
 *
 * Ни одной выдуманной цифры: процента готовности, «шанса поступления» и прочих
 * показателей, которые нечем посчитать, здесь нет.
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
  ownerRole: string;
  nextAction: string | null;
  nextActionAt: string | null;
  leadHref: string | null;
  source: string | null;
  stage: string | null;
  applications: readonly StudentApplication[];
  visa: readonly VisaMilestone[];
  /** Причина финансового стопа. null — стопа нет. */
  financeStop: string | null;
  timeline: readonly TimelineEntry[];
}>;

/** Виды визовых вех — ключи из модели, подписи для людей. */
const VISA_KIND: Record<string, string> = {
  document_preparation: "Подготовка документов",
  submission: "Подача",
  appointment: "Запись",
  biometrics: "Биометрия",
  interview: "Собеседование",
  decision: "Решение",
};

const STATUS_TONE: Record<string, PillTone> = {
  active: "ok",
  completed: "ok",
  approved: "ok",
  pending: "neutral",
  draft: "neutral",
  blocked: "danger",
  rejected: "danger",
};

const tone = (status: string): PillTone => STATUS_TONE[status] ?? "neutral";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <h3 className="border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Student360({ student }: { student: StudentCase }) {
  return (
    <div className="flex flex-col gap-4">
      {/* ---- Шапка ---- */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 text-xl font-semibold tracking-[-0.02em] text-fg">
          {student.person}
        </h2>
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone={tone(student.status)}>{student.status}</Pill>
          {student.stage ? <Pill tone="info">{student.stage}</Pill> : null}
          <Pill>{student.ownerRole}</Pill>
          {student.source ? <Pill>{student.source}</Pill> : null}
        </span>
        {student.leadHref ? (
          <Link
            href={student.leadHref}
            prefetch={false}
            className="inline-flex min-h-6 items-center text-xs text-fg-2 underline decoration-border-strong underline-offset-4 hover:decoration-fg-2"
          >
            Lead 360
          </Link>
        ) : null}
      </header>

      {/* ---- То, что остановило работу ---- */}
      {/* Стоп — самое важное на экране, но заливать им полосу во всю ширину
          нельзя: в этом мире цвет живёт в пилюлях. Вес даёт левое ребро и
          пилюля, а не красная стена. */}
      {student.financeStop ? (
        <p className="flex flex-wrap items-start gap-2 rounded-card border border-border border-s-2 border-s-danger bg-surface px-4 py-3 text-sm leading-5 text-fg">
          <Pill tone="danger">финансовый стоп</Pill>
          <span className="min-w-0 flex-1">{student.financeStop}</span>
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* ---- Что дальше ---- */}
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

          {/* ---- Заявки ---- */}
          <Section title="Заявки в вузы">
            <ul>
              {student.applications.map((application) => (
                <li key={application.id} className="border-b border-border px-4 py-3 last:border-b-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-fg">{application.program}</span>
                    <Pill tone={tone(application.status)}>{application.status}</Pill>
                    <Pill>{application.intake}</Pill>
                  </p>
                  <p className="mt-0.5 text-2xs text-fg-3">{application.institution}</p>
                  {application.nextAction ? (
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-2">
                      {application.nextAction}
                      {application.nextActionAt ? (
                        <Pill tone="warn">{application.nextActionAt}</Pill>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              ))}
              {student.applications.length === 0 ? (
                <li className="px-4 py-3 text-sm text-fg-3">Заявок нет.</li>
              ) : null}
            </ul>
          </Section>

          {/* ---- Виза ---- */}
          <Section title="Виза">
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
                    {VISA_KIND[milestone.kind] ?? milestone.kind}
                  </span>
                  {milestone.blockedReason ? (
                    <span className="truncate text-2xs text-danger">{milestone.blockedReason}</span>
                  ) : null}
                  {milestone.due ? <Pill>{milestone.due}</Pill> : null}
                  <Pill tone={tone(milestone.status)}>{milestone.status}</Pill>
                </li>
              ))}
              {student.visa.length === 0 ? (
                <li className="px-4 py-3 text-sm text-fg-3">Визовых вех нет.</li>
              ) : null}
            </ol>
          </Section>
        </div>

        {/* ---- История ---- */}
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
            {student.timeline.map((entry) => (
              <li key={entry.id} className="border-b border-border px-4 py-2.5 last:border-b-0">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-2xs text-fg">
                    {entry.transition}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-fg-3">{entry.at}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-fg-3">
                  {entry.from ? `${entry.from} → ` : ""}
                  {entry.to ?? "—"}
                  <Pill>{entry.role}</Pill>
                </p>
              </li>
            ))}
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
