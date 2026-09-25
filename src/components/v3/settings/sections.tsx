import { randomUUID } from "node:crypto";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { btnGhostCls } from "@/components/ui";
import { Pill } from "@/components/v3/Pill";
import { setLookPreviewAction } from "@/lib/v3/look-preview-actions";

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
            <span className="t-caption text-fg-3">
              {item.name}
            </span>
            <span className="t-item text-fg">{item.state}</span>
            <span className="t-meta text-fg-3">{item.detail}</span>
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
              <span className="t-body-compact text-fg-2">{item.blocker}</span>
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
                <dt className="t-caption w-40 shrink-0 text-fg-3">Подробности</dt>
                <dd className="min-w-0 flex-1 text-sm text-fg">{item.detail}</dd>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
                <dt className="t-caption w-40 shrink-0 text-fg-3">Что требуется</dt>
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
              <span className="t-meta text-fg-3">{one.detail}</span>
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
                  <span className={active.objectType === type.key ? "tabular-nums" : "tabular-nums text-fg-3"}>
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
            {events.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-fg-3">
                По этому фильтру событий нет.
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

export function PlatformSection({ platform, salesImportHref, lookPreview }: { platform: string; salesImportHref?: string; lookPreview: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Э1.1 плана редизайна: временный предпросмотр нового облика до решения владельца (Э1.5). */}
      <Card title="Новый облик — предпросмотр">
        <form action={setLookPreviewAction} className="flex flex-col items-start gap-3 px-4 py-3" data-testid="v3-look-preview">
          <p className="t-body-compact max-w-[60ch] text-fg-2">
            Облик из плана редизайна: работа — белый лист на тёплом сером столе, «выбрано» — нейтральное,
            красный — только главное действие и проблема. Виден только вам в этом браузере; остальные сотрудники
            видят прежний облик, пока вы не решите.
          </p>
          <p className="t-body-compact text-fg">Сейчас: {lookPreview ? "новый облик" : "прежний облик"}</p>
          <input type="hidden" name="look" value={lookPreview ? "" : "next"} />
          <button type="submit" className={btnGhostCls}>{lookPreview ? "Выключить предпросмотр" : "Включить предпросмотр"}</button>
        </form>
      </Card>

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
              <span className="t-body-compact min-w-0 flex-1 text-fg-2">{why}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
