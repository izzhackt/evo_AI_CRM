import { randomUUID } from "node:crypto";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

import type { GateFacts, Health, Integration, JournalEntry } from "./types";
import { journalActor, journalEvent, journalObject } from "@/lib/v3/wording";

export function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface">
      <h3 className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
        {title}
        {aside ? <span className="font-normal normal-case tracking-normal">{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Краткое пояснение к правилам или состоянию. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-border bg-surface-2 px-4 py-2.5 text-2xs leading-4 text-fg-3">
      {children}
    </p>
  );
}

const TONE_EDGE: Record<Health["tone"], string> = {
  ok: "v3-edge-ok",
  warn: "v3-edge-warn",
  off: "v3-edge-muted",
};

/* ---------------------------------------------------------- Состояние */

export function StateSection({ health }: { health: readonly Health[] }) {
  const blocked = health.filter((h) => h.blocker !== null);

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 @lg:grid-cols-2 @6xl:grid-cols-3">
        {health.map((item) => (
          <li
            key={item.name}
            className={`flex flex-col gap-0.5 rounded-card border border-s-2 border-border bg-surface px-4 py-3 ${TONE_EDGE[item.tone]}`}
          >
            <span className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
              {item.name}
            </span>
            <span className="text-md font-bold tracking-[-0.01em] text-fg">{item.state}</span>
            <span className="text-2xs text-fg-3">{item.detail}</span>
          </li>
        ))}
      </ul>

      <Card title="Требует внимания" aside={<Pill tone="warn">{blocked.length}</Pill>}>
        <ul>
          {blocked.map((item) => (
            <li
              key={item.name}
              className="grid gap-x-4 gap-y-1 border-b border-border px-4 py-3 last:border-b-0 @4xl:grid-cols-[minmax(0,200px)_minmax(0,1fr)]"
            >
              <span className="text-sm font-semibold text-fg">{item.name}</span>
              <span className="text-2xs leading-4 text-fg-2">{item.blocker}</span>
            </li>
          ))}
        </ul>
        <Note>Для настройки подключений обратитесь к техническому специалисту.</Note>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------- Интеграции */

export function IntegrationsSection({
  health,
  integrations,
}: {
  health: readonly Health[];
  integrations: readonly Integration[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {health
        .filter((h) => h.blocker !== null && h.name !== "Хранилище документов")
        .map((item) => (
          <Card
            key={item.name}
            title={item.name}
            aside={<Pill tone={item.tone === "ok" ? "ok" : "neutral"}>{item.state}</Pill>}
          >
            <dl>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
                <dt className="w-40 shrink-0 text-2xs text-fg-3">Подробности</dt>
                <dd className="min-w-0 flex-1 text-sm text-fg">{item.detail}</dd>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
                <dt className="w-40 shrink-0 text-2xs text-fg-3">Что требуется</dt>
                <dd className="min-w-0 flex-1 text-sm text-fg">{item.blocker}</dd>
              </div>
            </dl>
          </Card>
        ))}

      <Card title="Подключения" aside={<Pill>{integrations.length}</Pill>}>
        <ul>
          {integrations.map((one) => (
            <li
              key={one.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 text-sm text-fg">{one.name}</span>
              <span className="text-2xs text-fg-3">{one.detail}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------- Журнал действий */

type JournalEvent = Extract<JournalEntry, { kind: "event" }>;
type JournalNextPage = Extract<JournalEntry, { kind: "page" }>;


function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function JournalSection({
  entries,
  exportEnabled,
  facets,
  active,
  hrefFor,
}: {
  entries: readonly JournalEntry[];
  exportEnabled: boolean;
  facets: Readonly<{
    objectTypes: readonly Readonly<{ key: string; count: number }>[];
  }>;
  active: Readonly<{ objectType?: string }>;
  hrefFor: (next: Readonly<{
    objectType?: string;
    snapshotAt?: string;
    snapshotId?: string;
    cursorAt?: string;
    cursorId?: string;
  }>) => string;
}) {
  const events = entries.filter(
    (entry): entry is JournalEvent => entry.kind === "event",
  );
  const nextPage = entries.find(
    (entry): entry is JournalNextPage => entry.kind === "page",
  ) ?? null;
  const named = events.filter(
    (entry) => journalEvent(entry.transition) !== null,
  );
  const unnamed = events.length - named.length;
  const exportEndAt = new Date();
  const exportStartAt = new Date(exportEndAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const chip = (on: boolean) =>
    `inline-flex min-h-8 items-center gap-1.5 rounded-nav border px-2.5 text-xs ${
      on
        ? "border-accent bg-accent text-on-accent"
        : "border-border bg-surface text-fg-2 hover:border-control-edge"
    }`;

  return (
    <div className="flex flex-col gap-4">
      {/* Фильтры — ссылки: адрес несёт выбор, поэтому отфильтрованный журнал
          можно переслать и вернуться назад кнопкой браузера. */}
      <nav aria-label="Фильтры журнала" className="flex flex-col gap-2">
        <p className="text-2xs uppercase tracking-wide text-fg-3">Тип записи</p>
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <Link href={hrefFor({})} className={chip(!active.objectType)}>
              Все
            </Link>
          </li>
          {facets.objectTypes.map((type) => {
            // Сырой ключ типа не показывается; тип без слова остаётся без
            // плитки, а его события считает строка «без названия» внизу.
            const word = journalObject(type.key);
            if (word === null) return null;
            return (
              <li key={type.key}>
                <Link
                  href={hrefFor({ objectType: type.key })}
                  className={chip(active.objectType === type.key)}
                >
                  {word}
                  <span className={active.objectType === type.key ? "text-on-accent" : "text-fg-3"}>
                    {type.count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

      </nav>

      {exportEnabled ? (
        <Card title="Экспорт журнала">
          <form
            action="/api/platform-audit/export"
            method="post"
            encType="application/x-www-form-urlencoded"
            data-testid="v3-audit-export"
            aria-describedby="v3-audit-export-scope"
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <input type="hidden" name="request_id" value={randomUUID()} />
            <input type="hidden" name="start_at" value={exportStartAt.toISOString()} />
            <input type="hidden" name="end_at" value={exportEndAt.toISOString()} />
            {active.objectType ? (
              <input type="hidden" name="resource_types" value={active.objectType} />
            ) : null}

            <p id="v3-audit-export-scope" className="text-xs leading-5 text-fg-2">
              Последние 30 дней ·{" "}
              {active.objectType
                ? (journalObject(active.objectType) ?? "выбранный тип объекта")
                : "все объекты"}{" "}
              · все участники
            </p>
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-ctl bg-accent px-3 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              <Icon name="download" size={16} />
              Скачать CSV
            </button>
          </form>
        </Card>
      ) : null}

      <Card
        title="События"
        aside={<Pill>{nextPage ? `${events.length}+` : events.length}</Pill>}
      >
        <div
          role="group"
          aria-label="Журнал действий"
          tabIndex={0}
          className="max-h-[540px] overflow-y-auto"
        >
          <ul>
            {named.map((entry) => {
              const objectWord = journalObject(entry.objectType);
              const actorWord = journalActor(entry.role);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 text-sm text-fg">
                    {journalEvent(entry.transition)}
                  </span>
                  {actorWord !== null ? <Pill>{actorWord}</Pill> : null}
                  <span className="shrink-0 font-mono text-2xs text-fg-3">{entry.at}</span>
                  {/* Имени объекта аудит не отдаёт — только тип и id. Короткий
                      id различает строки об одном типе, ссылка есть там, где
                      id ведёт в профиль нового мира. */}
                  <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fg-3">
                    {objectWord !== null ? <span>{objectWord}</span> : null}
                    {entry.objectId !== null ? (
                      <span className="font-mono">#{entry.objectId.slice(0, 8)}</span>
                    ) : null}
                    {entry.profileHref ? (
                      <Link
                        href={entry.profileHref}
                        className="inline-flex min-h-6 items-center font-medium text-accent hover:underline"
                      >
                        открыть профиль
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {events.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-fg-3">
                По этому фильтру событий нет.
              </li>
            ) : null}
          </ul>
        </div>
        {unnamed > 0 ? (
          <p className="border-t border-border px-4 py-2 text-2xs text-fg-3">
            {unnamed}{" "}
            {pluralRu(
              unnamed,
              "событие без названия",
              "события без названия",
              "событий без названия",
            )}
          </p>
        ) : null}
        {nextPage ? (
          <p className="border-t border-border px-4 py-2.5">
            <Link
              href={hrefFor({
                objectType: active.objectType,
                snapshotAt: nextPage.snapshotCreatedAt,
                snapshotId: nextPage.snapshotId,
                cursorAt: nextPage.cursorCreatedAt,
                cursorId: nextPage.cursorId,
              })}
              className="inline-flex min-h-8 items-center rounded-nav border border-border bg-surface px-2.5 text-xs text-fg-2 hover:border-control-edge"
            >
              Следующие события
            </Link>
          </p>
        ) : null}
        <Note>
          Для событий указан тип участника: сотрудник, сервис или система.
          Личные данные участников не показываются.
        </Note>
      </Card>
    </div>
  );
}

/* --------------------------------------------- Документы и передача */

export function DocumentsSection({ gates }: { gates: GateFacts }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Правила загрузки">
        <ul>
          {[
            ["Разрешённые типы", "PDF, JPEG, PNG"],
            ["Предельный размер", "25 МиБ"],
            ["Кто видит", "Только пользователи с нужными правами. Публичного доступа нет."],
          ].map(([k, v]) => (
            <li
              key={k}
              className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="w-44 shrink-0 text-2xs text-fg-3">{k}</span>
              <span className="min-w-0 flex-1 text-sm text-fg">{v}</span>
            </li>
          ))}
        </ul>
        <Note>
          Скачивание доступно после проверки целостности и безопасности файла.
        </Note>
      </Card>

      <Card title="Условия передачи в приёмную">
        <p className="px-4 py-3 text-sm leading-6 text-fg">
          Передать в приёмную можно после подтверждения договора <em>и</em> первого платежа.
          Исключение может подтвердить только администратор с указанием причины.
          Учитывается последнее подтверждение по лиду.
        </p>
        <ul className="grid gap-px bg-border @lg:grid-cols-4">
          {[
            ["Передач", gates.handoffs],
            ["Исключений", gates.overrides],
            ["Подтверждений", gates.evidence],
            ["Финансовых стопов", gates.financeStops],
          ].map(([label, n]) => (
            <li key={String(label)} className="bg-surface px-4 py-3">
              <span className="block text-2xs text-fg-3">{label}</span>
              <span className="block text-lg font-bold text-fg">{n}</span>
            </li>
          ))}
        </ul>
        <Note>
          Финансовый стоп блокирует подачу заявки в вуз и этап визы «Подача».
          Установить его может приёмная, снять — только администратор.
        </Note>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ Платформа */

export function PlatformSection({ platform, salesImportHref }: { platform: string; salesImportHref?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Что сейчас запущено">
        <dl>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
            <dt className="w-44 shrink-0 text-2xs text-fg-3">База данных</dt>
            <dd className="min-w-0 flex-1 text-sm text-fg">{platform}</dd>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2.5">
            <dt className="w-44 shrink-0 text-2xs text-fg-3">Настройки окружения</dt>
            <dd className="min-w-0 flex-1 text-sm text-fg">только для чтения</dd>
          </div>
        </dl>
      </Card>

      {salesImportHref ? (
        <Link
          href={salesImportHref}
          className="inline-flex min-h-11 items-center self-start rounded-ctl text-sm font-medium text-accent underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Перенос данных отчёта продаж
        </Link>
      ) : null}

      <Card title="Требует внимания">
        <ul>
          {[
            ["Автоматические оповещения", "Не подключены. При сбое свяжитесь с техническим специалистом."],
            ["Восстановление данных", "Восстановление из резервной копии не проверено."],
            ["План восстановления", "Допустимая потеря данных и время восстановления не согласованы."],
          ].map(([what, why]) => (
            <li
              key={what}
              className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="w-52 shrink-0 text-sm font-medium text-fg">{what}</span>
              <span className="min-w-0 flex-1 text-2xs leading-4 text-fg-2">{why}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
