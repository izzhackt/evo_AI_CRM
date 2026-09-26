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
 * Часть второй строки. Разделитель «·» стоит в собственном отступе части;
 * строка сдвинута влево на этот отступ и обрезана, поэтому у части, которая
 * начинает строку (первой или перенесённой), разделитель уходит за край.
 */
const PIECE = "relative flex min-h-6 items-center gap-x-1 ps-3 before:absolute before:start-1 before:top-0 before:flex before:h-6 before:items-center before:text-fg-2 before:content-['·']";

/**
 * Строка «Сегодня» без действия на месте: студент, лид, заявка или переписка.
 * Та же сетка, что у строки «Задач» (`TaskQueueRow`): знак источника вместо
 * круга, срок своей колонкой перед названием (JetBrains Mono «ДД.ММ» и
 * слово), под названием — кто и почему. Действие одно — «Открыть»
 * существующую панель; эта ссылка покрывает всю строку, и фокус клавиатуры —
 * рамка всей строки (`.v3-queue-row`). Имя человека — ссылка на его карточку
 * только при мыши на широком экране (как у «Задач»).
 *
 * Красный — только у просроченного срока и его слова; причина — обычный
 * текст (группа «Просрочено» уже названа красным). Причина не сокращается
 * никогда: на узкой строке она идёт сразу за сроком, а имя — последним и
 * сокращается; если части или имени места нет, они переносятся целиком.
 * На широкой — «имя · причина»; имя сокращается, только если длиннее строки.
 */
export function TodayRow({ item, nowIso }: Readonly<{ item: TodayItem; nowIso: string }>) {
  const when = todayWhen(item, new Date(nowIso));
  const icon = item.source === "tasks" ? "check-square" : SOURCE_ICON[item.source];
  // На узкой строке слово срока остаётся только у «Ближайших» и там, где даты
  // нет: «прошёл» и «сегодня» повторили бы заголовок группы.
  const phoneWord = when?.word && (item.band === "upcoming" || when.text === null) ? when.word : null;
  return (
    <li
      data-queue-row={item.key}
      data-today-source={item.source}
      className="v3-queue-row relative grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-x-2 border-b border-border hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface @min-[32rem]:grid-cols-[2.75rem_7rem_minmax(0,1fr)_auto]"
    >
      <span aria-hidden="true" className="grid size-11 place-items-center text-fg-3">
        <Icon name={icon} size={20} />
      </span>

      <p className="hidden self-start pt-1 t-body-compact @min-[32rem]:block">
        {when?.text ? <>
          <time dateTime={when.dateTime ?? undefined} className={`block font-mono tabular-nums ${when.overdue ? "text-danger" : "text-fg"}`}>{when.text}</time>
          {when.word ? <span className={`flex min-h-6 items-center t-meta ${when.overdue ? "text-danger" : "text-fg-3"}`}>{when.word}</span> : null}
        </> : when?.word ? <span className="block text-fg-2">{when.word}</span> : null}
      </p>

      <div className="min-w-0 py-0.5">
        <p title={item.title} className="line-clamp-2 break-words py-0.5 t-item text-fg @min-[32rem]:line-clamp-1">{item.title}</p>
        <div className="overflow-hidden">
          <p className="-ms-3 flex flex-wrap t-meta text-fg-2" data-today-meta="">
            {/* Узкая строка: срок первым, как колонка срока на широкой. */}
            {when?.text || phoneWord ? (
              <span className={`${PIECE} shrink-0 whitespace-nowrap @min-[32rem]:hidden ${when?.overdue ? "text-danger" : ""}`}>
                {when?.text ? <time dateTime={when.dateTime ?? undefined} className="font-mono tabular-nums">{when.text}</time> : null}
                {phoneWord ? <span>{phoneWord}</span> : null}
              </span>
            ) : null}
            {/* Причина «шаг просрочен · ждёт принятия» — по части на слово: на узкой
                строке переносится целая часть, а не обрывок, и разделитель не
                остаётся висеть в конце строки. */}
            {item.reason.split(" · ").map((part, index) => (
              <span key={`${index}:${part}`} className={`${PIECE} order-1 max-w-full @min-[32rem]:order-2`} data-today-reason="">{part}</span>
            ))}
            {item.who ? (
              <span className={`${PIECE} order-2 min-w-[5.5rem] flex-1 basis-0 @min-[32rem]:order-1 @min-[32rem]:min-w-0 @min-[32rem]:max-w-full @min-[32rem]:flex-initial @min-[32rem]:basis-auto`}>
                {/* Рамка фокуса внутрь: у края обрезанной строки внешняя срезалась бы. */}
                <Link href={item.who.href} title={item.who.name}
                  className="relative z-10 hidden h-6 min-w-0 items-center rounded-nav underline-offset-2 hover:text-fg hover:underline focus-visible:outline-offset-[-2px] md:pointer-fine:flex">
                  <span className="truncate">{item.who.name}</span>
                </Link>
                <span className="min-w-0 truncate md:pointer-fine:hidden">{item.who.name}</span>
              </span>
            ) : null}
          </p>
        </div>
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
