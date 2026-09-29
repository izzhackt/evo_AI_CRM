import { randomUUID } from "node:crypto";

import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

import type { IntegrationTone } from "@/lib/v3/settings-health";

import type { GateFacts, IntegrationRow, JournalEntry } from "./types";
import { journalActor, journalEvent, journalObject } from "@/lib/v3/wording";
import { journalNotice, type JournalStatus } from "@/lib/v3/settings-journal-contract";
import { QUEUE_QUIET_LINK } from "@/components/v3/queue/QueueStates";

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
      <h3 className="t-section flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-fg">
        {title}
        {aside ? <span className="t-body-compact">{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Краткое пояснение к правилам или состоянию. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="t-meta border-t border-border bg-surface-2 px-4 py-2.5 text-fg-3">
      {children}
    </p>
  );
}

/* --------------------------------------------------------- Интеграции */

/** Значок состояния: только подкрепляет слово, у читалки остаётся слово. */
const TONE_ICON: Record<IntegrationTone, { name: IconName; className: string }> = {
  ok: { name: "circle-check", className: "text-ok" },
  warn: { name: "alert", className: "text-warn" },
  blocked: { name: "alert", className: "text-danger" },
  off: { name: "circle", className: "text-fg-3" },
};

/**
 * Две раскладки по ширине своего контейнера (`@container/integrations`): от
 * 40rem — строка таблицы (Сервис · Состояние · Последняя проверка · Что не
 * работает · Что сделать); уже — стопка: сервис и состояние, под ними
 * подписанные строки. Роли таблицы заданы явно: смена display иначе стирает
 * её семантику в части браузеров.
 */
const INTEGRATION_GRID = "grid grid-cols-1 gap-x-4 gap-y-1 px-4 @min-[40rem]/integrations:grid-cols-[minmax(0,17fr)_minmax(0,17fr)_minmax(0,11fr)_minmax(0,27fr)_minmax(0,21fr)]";
const INTEGRATION_ROW = `${INTEGRATION_GRID} border-b border-border py-3 last:border-b-0 @min-[40rem]/integrations:py-2.5`;
const INTEGRATION_HEAD = "t-caption flex items-center text-start text-fg-2";
const INTEGRATION_COLUMNS = ["Сервис", "Состояние", "Последняя проверка", "Что не работает", "Что сделать"] as const;
/** В стопке у ячейки своя подпись: шапки колонок там нет. */
function StackLabel({ children }: { children: string }) {
  return <span className="t-caption me-1.5 text-fg-3 @min-[40rem]/integrations:sr-only">{children}:</span>;
}

export function IntegrationsSection({ rows }: { rows: readonly IntegrationRow[] }) {
  return (
    <div className="@container/integrations">
      <table role="table" className="block w-full overflow-hidden rounded-card border border-border bg-surface" data-testid="v3-settings-integrations">
        <caption className="sr-only">Интеграции: состояние, последняя проверка и что не работает без сервиса</caption>
        <thead role="rowgroup" className="sr-only @min-[40rem]/integrations:not-sr-only @min-[40rem]/integrations:block">
          <tr role="row" className={`${INTEGRATION_GRID} border-b border-border py-2`}>
            {INTEGRATION_COLUMNS.map((label) => (
              <th key={label} role="columnheader" scope="col" className={INTEGRATION_HEAD}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="block">
          {rows.map((row) => {
            const icon = TONE_ICON[row.tone];
            return (
              <tr key={row.key} role="row" data-integration={row.key} data-tone={row.tone} className={INTEGRATION_ROW}>
                <th role="rowheader" scope="row" className="t-item min-w-0 text-start text-fg">{row.name}</th>
                <td role="cell" className="min-w-0 t-body-compact">
                  <span className="inline-flex items-start gap-1.5 text-fg">
                    <Icon name={icon.name} size={16} className={`mt-0.5 shrink-0 ${icon.className}`} />
                    <span className={row.tone === "blocked" ? "font-medium text-danger" : undefined}>{row.state}</span>
                  </span>
                  {row.detail ? <span className="t-meta block text-fg-2">{row.detail}</span> : null}
                </td>
                <td role="cell" className="min-w-0 t-body-compact text-fg-2">
                  <StackLabel>Последняя проверка</StackLabel>
                  {row.checkedAt && row.checkedText ? (
                    <time dateTime={row.checkedAt} className="font-mono tabular-nums text-fg">{row.checkedText}</time>
                  ) : row.checkable ? (
                    <span className="text-fg-3">нет данных</span>
                  ) : (
                    <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">проверки нет</span></>
                  )}
                </td>
                <td role="cell" className="min-w-0 t-body-compact text-fg">
                  <StackLabel>Что не работает</StackLabel>
                  {row.without ?? <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">всё работает</span></>}
                </td>
                <td role="cell" className="min-w-0 t-body-compact">
                  {/* Кто делает работу на сервере, затем страница CRM по сервису: у действия всегда есть путь. */}
                  {row.action ? (
                    <>
                      <StackLabel>Что сделать</StackLabel>
                      {row.action.handoff ? <span className="text-fg-2">{row.action.handoff}</span> : null}
                      {row.action.link ? (
                        <span className={row.action.handoff ? "block" : undefined}>
                          <Link
                            href={row.action.link.href}
                            className={`inline-flex min-h-11 items-center font-medium text-fg underline underline-offset-4 hover:text-fg-2 ${row.action.handoff ? "" : "@min-[40rem]/integrations:-my-2.5"}`}
                          >
                            {row.action.link.label}
                          </Link>
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <><span aria-hidden="true" className="text-fg-3 @max-[40rem]/integrations:hidden">—</span><span className="sr-only">ничего</span></>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("ru") + text.slice(1);

/**
 * Одно предупреждение над настройками — только когда настроенный сервис
 * сломан и работа стоит (`blocksWork`). Нет таких — нет и строки: «не
 * используется» и «не проверялось» — факты таблицы, не тревога.
 */
export function IntegrationsBanner({ rows, href }: { rows: readonly IntegrationRow[]; href: string | null }) {
  const blocking = rows.filter((row) => row.blocksWork);
  if (!blocking.length) return null;
  return (
    <div role="status" data-testid="v3-settings-blocking" className="mb-5 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card border border-border bg-surface px-4 py-3">
      <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
      <p className="t-body-compact min-w-0 flex-1 text-fg">
        <span className="font-medium text-danger">{blocking.length === 1 ? "Не работает" : "Не работают"}: </span>
        {blocking.map((row) => `${row.name}${row.detail ? ` — ${lowerFirst(row.detail.replace(/\.$/u, ""))}` : ""}`).join("; ")}.
      </p>
      {href ? (
        <Link href={href} className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4 hover:text-fg-2 sm:-my-2.5">
          Открыть «Интеграции»
        </Link>
      ) : null}
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
  status,
  exportEnabled,
  facets,
  active,
  hrefFor,
}: {
  entries: readonly JournalEntry[];
  /** Выключенный или недоступный журнал — словами, без числа (Э8.11). */
  status: JournalStatus;
  exportEnabled: boolean;
  facets: Readonly<{
    objectTypes: readonly Readonly<{ key: string; count: number | null }>[];
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
  const notice = journalNotice(status, active, events.length);
  const exportEndAt = new Date();
  const exportStartAt = new Date(exportEndAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const chip =
    "v3-choice inline-flex min-h-8 items-center gap-1.5 rounded-nav border border-border bg-surface px-2.5 text-xs text-fg-2 hover:border-control-edge";

  return (
    <div className="flex flex-col gap-4">
      {/* Фильтры — ссылки: адрес несёт выбор, поэтому отфильтрованный журнал
          можно переслать и вернуться назад кнопкой браузера. */}
      <nav aria-label="Фильтры журнала" className="flex flex-col gap-2">
        <p className="t-caption text-fg-3">Тип записи</p>
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <Link href={hrefFor({})} aria-current={!active.objectType ? "page" : undefined} className={chip}>
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
                  aria-current={active.objectType === type.key ? "page" : undefined}
                  className={chip}
                >
                  {word}
                  {type.count !== null ? (
                    <span className={active.objectType === type.key ? "tabular-nums" : "tabular-nums text-fg-3"}>
                      {type.count}
                    </span>
                  ) : null}
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
        // Число — только у прочитанного журнала: выключенный или
        // недоступный журнал не «0» (Э8.11).
        aside={status === "ready" ? <Pill>{nextPage ? `${events.length}+` : events.length}</Pill> : undefined}
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
                  <span className="t-meta shrink-0 font-mono text-fg-3">{entry.at}</span>
                  {/* Имени объекта аудит не отдаёт — только тип и id. Короткий
                      id различает строки об одном типе, ссылка есть там, где
                      id ведёт в профиль нового мира. */}
                  <span className="t-meta flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-fg-3">
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
            {notice ? (
              <li
                data-testid="v3-journal-notice"
                data-journal-status={status}
                className="flex flex-col items-center gap-1 px-4 py-8 text-center"
              >
                <p
                  role={notice.retry ? "alert" : undefined}
                  className={notice.retry ? "t-item text-danger" : status === "disabled" ? "t-item text-fg" : "text-sm text-fg-3"}
                >
                  {notice.text}
                </p>
                {notice.detail ? <p className="t-meta text-fg-3">{notice.detail}</p> : null}
                {notice.retry ? (
                  <Link href={hrefFor({ objectType: active.objectType })} className={QUEUE_QUIET_LINK}>
                    Повторить
                  </Link>
                ) : null}
              </li>
            ) : null}
          </ul>
        </div>
        {unnamed > 0 ? (
          <p className="t-meta border-t border-border px-4 py-2 text-fg-3">
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
              <span className="t-caption w-44 shrink-0 text-fg-3">{k}</span>
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
              <span className="t-caption block text-fg-3">{label}</span>
              <span className="t-item block tabular-nums text-fg">{n}</span>
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

export function PlatformSection({ platform, salesImportHref, salesManagersHref }: { platform: string; salesImportHref?: string; salesManagersHref?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Что сейчас запущено">
        <dl>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
            <dt className="t-caption w-44 shrink-0 text-fg-3">База данных</dt>
            <dd className="min-w-0 flex-1 text-sm text-fg">{platform}</dd>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2.5">
            <dt className="t-caption w-44 shrink-0 text-fg-3">Настройки окружения</dt>
            <dd className="min-w-0 flex-1 text-sm text-fg">только для чтения</dd>
          </div>
        </dl>
      </Card>

      {salesImportHref || salesManagersHref ? (
        <div className="flex flex-wrap gap-x-6">
          {[[salesImportHref, "Перенос данных отчёта продаж"], [salesManagersHref, "Менеджеры в отчёте продаж"]].map(([href, label]) => href ? (
            <Link
              key={label}
              href={href}
              className="inline-flex min-h-11 items-center self-start rounded-ctl text-sm font-medium text-accent underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {label}
            </Link>
          ) : null)}
        </div>
      ) : null}

      {/* Факты эксплуатации (аудит 26.09), а не тревога: заголовок называет тему (Э6). */}
      <Card title="Эксплуатация">
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
              <span className="t-body-compact min-w-0 flex-1 text-fg-2">{why}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
