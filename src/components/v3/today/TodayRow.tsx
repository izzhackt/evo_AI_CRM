import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import { todayWhen, type TodayItem, type TodaySource } from "@/lib/v3/today-queue";

/** Знак источника в колонке, где у задачи круг завершения: строка без действия на месте. */
const SOURCE_ICON: Readonly<Record<Exclude<TodaySource, "tasks">, IconName>> = {
  students: "users",
  handoffs: "users",
  leads: "funnel",
  requests: "file-check",
  chats: "message-square",
};

/**
 * Строка «Сегодня» без действия на месте: студент, лид, заявка или переписка.
 * Та же сетка, что у строки «Задач» (`TaskQueueRow`): знак источника вместо
 * круга, срок своей колонкой перед названием (JetBrains Mono «ДД.ММ» и
 * слово), под названием — кто и почему. Действие одно — «Открыть»
 * существующую панель; эта ссылка покрывает всю строку. Имя человека —
 * ссылка на его карточку только при мыши на широком экране (как у «Задач»).
 */
export function TodayRow({ item, nowIso }: Readonly<{ item: TodayItem; nowIso: string }>) {
  const when = todayWhen(item, new Date(nowIso));
  const icon = item.source === "tasks" ? "check-square" : SOURCE_ICON[item.source];
  const reasonTone = item.band === "overdue" ? "text-danger" : "text-fg-2";
  // На узкой строке слово срока остаётся только у «Ближайших»: «прошёл» и
  // «сегодня» повторили бы заголовок группы, у ждущих хватает даты.
  const phoneWord = item.band === "upcoming";
  return (
    <li
      data-queue-row={item.key}
      data-today-source={item.source}
      className="relative grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-x-2 border-b border-border hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface @min-[32rem]:grid-cols-[2.75rem_7rem_minmax(0,1fr)_auto]"
    >
      <span aria-hidden="true" className="grid size-11 place-items-center text-fg-3">
        <Icon name={icon} size={20} />
      </span>

      <p className="hidden self-start pt-1 t-body-compact @min-[32rem]:block">
        {when ? <>
          <time dateTime={when.dateTime} className={`block font-mono tabular-nums ${when.overdue ? "text-danger" : "text-fg"}`}>{when.text}</time>
          {when.word ? <span className={`flex min-h-6 items-center t-meta ${when.overdue ? "text-danger" : "text-fg-3"}`}>{when.word}</span> : null}
        </> : null}
      </p>

      <div className="min-w-0 py-0.5">
        <p title={item.title} className="line-clamp-2 break-words py-0.5 t-item text-fg @min-[32rem]:line-clamp-1">{item.title}</p>
        <p className="flex min-h-6 min-w-0 items-center gap-x-1 overflow-hidden whitespace-nowrap t-meta text-fg-2">
          {/* Узкая строка: срок первым, как колонка срока на широкой; место — имени. */}
          {when ? (
            <span className="shrink-0 @min-[32rem]:hidden">
              <span className={when.overdue ? "text-danger" : undefined}>
                <time dateTime={when.dateTime} className="font-mono tabular-nums">{when.text}</time>{when.word && phoneWord ? ` ${when.word}` : null}
              </span> ·
            </span>
          ) : null}
          {item.who ? <>
            <Link href={item.who.href} title={item.who.name}
              className="relative z-10 hidden h-6 min-w-0 items-center underline-offset-2 hover:text-fg hover:underline md:pointer-fine:flex">
              <span className="truncate">{item.who.name}</span>
            </Link>
            <span className="min-w-0 truncate md:pointer-fine:hidden">{item.who.name}</span>
            <span aria-hidden="true" className="shrink-0">·</span>
          </> : null}
          {/* На узкой строке первой сокращается причина, имя — последним. */}
          <span className={`min-w-0 shrink-[4] truncate ${reasonTone}`}>{item.reason}</span>
        </p>
      </div>

      <div className="flex justify-end">
        <Link
          href={item.openHref}
          data-queue-open=""
          aria-label={`Открыть: ${item.title}`}
          className="grid min-h-11 min-w-11 place-items-center rounded-nav t-label text-fg-2 before:absolute before:inset-0 before:content-[''] hover:text-fg @min-[32rem]:px-3 @min-[32rem]:underline @min-[32rem]:underline-offset-4"
        >
          <span aria-hidden="true" className="hidden @min-[32rem]:inline">Открыть</span>
          <Icon name="chevron-right" size={20} className="@min-[32rem]:hidden" />
        </Link>
      </div>
    </li>
  );
}
