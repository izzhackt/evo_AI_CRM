import type { JournalNextRow, JournalNextType, SettingsJournalProps } from "@/components/v3/settings-next/settings-next-types";
import type { JournalEntry } from "@/components/v3/settings/types";
import { journalNotice, type JournalStatus } from "@/lib/v3/settings-journal-contract";
import { journalActor, journalEvent, journalEventText, journalObject } from "@/lib/v3/wording";

type JournalHref = Readonly<{ objectType?: string; snapshotAt?: string; snapshotId?: string; cursorAt?: string; cursorId?: string }>;
type EventEntry = Extract<JournalEntry, { kind: "event" }>;
type PageEntry = Extract<JournalEntry, { kind: "page" }>;

/**
 * Свойства «Журнала действий» нового вида. Слова (событие, тип участника, тип объекта, подписи фильтров, сообщение вместо строк) считает сервер:
 * таблицы слов журнала (`journalObject`, `journalActor`) лежат в `wording.ts`, и клиентский вход, что их импортирует, тащил бы их в общий
 * кусок первой загрузки каждого маршрута (в том числе портала студентов). Здесь только данные страницы; чтения и права — страницы.
 */
export function journalNextProps(input: Readonly<{
  entries: readonly JournalEntry[];
  status: JournalStatus;
  facets: Readonly<{ objectTypes: readonly Readonly<{ key: string; count: number | null }>[] }>;
  filters: Readonly<{ objectType?: string }>;
  hrefFor: (next: JournalHref) => string;
  exportEnabled: boolean;
  exportRequestId: string;
  now: Date;
}>): SettingsJournalProps {
  const events = input.entries.filter((entry): entry is EventEntry => entry.kind === "event");
  const nextPage = input.entries.find((entry): entry is PageEntry => entry.kind === "page") ?? null;
  const objectType = input.filters.objectType;
  const active = objectType ? { objectType } : {};
  const rows: JournalNextRow[] = events.flatMap((entry) => {
    const event = journalEventText(entry.transition, entry.directionChange);
    // Событие без слова (действие, которого код ещё не знает) в таблицу не попадает: его считает строка «без названия».
    return journalEvent(entry.transition) === null || event === null ? [] : [{
      id: entry.id, event, at: entry.at, actor: journalActor(entry.role) ?? "", object: journalObject(entry.objectType),
      objectId: entry.objectId, profileHref: entry.profileHref,
    }];
  });
  // Выбранный тип остаётся с «Все»: список типов может не читаться (пуст), а сбросить фильтр из адреса нужно. Тип без слова остаётся без плитки.
  const types: JournalNextType[] | null = input.facets.objectTypes.length > 0 || objectType
    ? [
      { key: "all", title: "Все", count: null, href: input.hrefFor({}), active: !objectType },
      ...input.facets.objectTypes.flatMap((type) => {
        const title = journalObject(type.key);
        return title === null ? [] : [{ key: type.key, title, count: type.count, href: input.hrefFor({ objectType: type.key }), active: objectType === type.key }];
      }),
    ]
    : null;
  const end = input.now;
  return {
    status: input.status,
    rows,
    unnamed: events.length - rows.length,
    notice: journalNotice(input.status, active, events.length),
    types,
    exportEnabled: input.exportEnabled,
    exportHelp: `Последние 30 дней · ${objectType ? (journalObject(objectType) ?? "выбранный тип объекта") : "все объекты"} · все участники.`,
    exportObjectType: objectType ?? null,
    exportRequestId: input.exportRequestId,
    exportStartAt: new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString(),
    exportEndAt: end.toISOString(),
    nextHref: nextPage
      ? input.hrefFor({ objectType, snapshotAt: nextPage.snapshotCreatedAt, snapshotId: nextPage.snapshotId, cursorAt: nextPage.cursorCreatedAt, cursorId: nextPage.cursorId })
      : null,
    retryHref: input.hrefFor({ objectType }),
  };
}
