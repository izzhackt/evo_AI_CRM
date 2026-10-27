import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import { Icon, type IconName } from "@/components/icons";
import { todayDialLeadId, type DialOptions } from "@/lib/v3/telephony-dial";
import { todayWhen, type TodayItem, type TodaySource } from "@/lib/v3/today-queue";

import { QUEUE_META_PIECE } from "../queue/meta-piece";
import { DialButton } from "../telephony/DialButton";

/** Знак источника в колонке, где у задачи круг завершения: строка без действия на месте. */
const SOURCE_ICON: Readonly<Record<Exclude<TodaySource, "tasks">, IconName>> = {
  students: "users",
  handoffs: "users",
  leads: "funnel",
  requests: "file-check",
  chats: "message-square",
};

/** Часть второй строки (разделитель в её отступе, перенос целиком): общая с «Заявками», `queue/meta-piece.ts`. */
const PIECE = QUEUE_META_PIECE;

/**
 * Строка «Сегодня» без действия на месте: студент, лид, заявка, переписка или
 * срок вуза (название — вуз, причина — «срок подачи» и программа).
 * Та же сетка, что у строки «Задач» (`TaskQueueRow`): знак источника вместо
 * круга, срок своей колонкой перед названием (JetBrains Mono «ДД.ММ» и
 * слово), под названием — кто и почему. Действие одно — «Открыть»
 * существующую панель; эта ссылка покрывает всю строку, и фокус клавиатуры —
 * рамка всей строки (`.v3-queue-row`). Имя этой ссылки называет и человека
 * («Открыть: Новая заявка — имя»): у многих строк одно название. Имя
 * человека — ссылка на его карточку только при мыши на широком экране (как у
 * «Задач»).
 *
 * Красный — только у просроченного срока и его слова; причина — обычный
 * текст (группа «Просрочено» уже названа красным). Причина не сокращается
 * никогда: на узкой строке она идёт сразу за сроком, а имя — последним и
 * сокращается; если части или имени места нет, они переносятся целиком.
 * На широкой — «имя · причина»; имя сокращается, только если длиннее строки.
 *
 * «Позвонить» («Телефония Beeline KG», T7): у строки лида или заявки, когда база открыла набор
 * этому сотруднику (`dial`) — значок 44 px рядом с «Открыть», над ссылкой, покрывающей строку.
 * Задачи и дела студентов кнопки не получают: в строке нет лида (`todayDialLeadId`).
 */
export function TodayRow({ item, nowIso, dial = null, hideReason = false, stacked = false }: Readonly<{
  item: TodayItem;
  nowIso: string;
  dial?: DialOptions | null;
  /** Причина одна у всей группы и уже стоит под её заголовком: у строки её нет. */
  hideReason?: boolean;
  /**
   * Строка всегда двухстрочная, как на узком контейнере: виджет «Нового вида» стоит в половине страницы, и
   * широкая сетка (знак · срок · название · «Открыть») на его ширине обрезала бы название. У прежнего вида нет.
   */
  stacked?: boolean;
}>) {
  /** Классы широкой строки (от 32rem контейнера): у `stacked` их нет. */
  const wide = (classes: string) => (stacked ? "" : classes);
  const when = todayWhen(item, new Date(nowIso));
  const dialLeadId = dial?.status === "ready" ? todayDialLeadId(item) : null;
  const icon = item.source === "tasks" ? "check-square" : SOURCE_ICON[item.source];
  // На узкой строке слово срока остаётся только у «Ближайших» и там, где даты
  // нет: «прошёл» и «сегодня» повторили бы заголовок группы.
  const phoneWord = when?.word && (item.band === "upcoming" || when.text === null) ? when.word : null;
  const wordTone = when?.overdue ? "text-danger" : null;
  return (
    <li
      data-queue-row={item.key}
      data-today-source={item.source}
      className={`v3-queue-row relative grid ${dialLeadId ? "grid-cols-[2.75rem_minmax(0,1fr)_5.5rem]" : "grid-cols-[2.75rem_minmax(0,1fr)_2.75rem]"} items-center gap-x-2 border-b border-border hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface${wide(" @min-[32rem]:grid-cols-[2.75rem_7rem_minmax(0,1fr)_auto]")}`}
    >
      <span aria-hidden="true" className="grid size-11 place-items-center text-fg-3">
        <Icon name={icon} size={20} />
      </span>

      <p className={`hidden self-start pt-1 t-body-compact${wide(" @min-[32rem]:block")}`}>
        {when?.text ? <>
          <time dateTime={when.dateTime ?? undefined} className={`block font-mono tabular-nums ${when.overdue ? "text-danger" : "text-fg"}`}>{when.text}</time>
          {when.word ? <span className={`flex min-h-6 items-center t-meta ${wordTone ?? "text-fg-3"}`}>{when.word}</span> : null}
        </> : when?.word ? <span className="block text-fg-2">{when.word}</span> : null}
      </p>

      <div className="min-w-0 py-0.5">
        <p title={item.title} className={`line-clamp-2 break-words py-0.5 t-item text-fg${wide(" @min-[32rem]:line-clamp-1")}`}>{item.title}</p>
        <div className="overflow-hidden">
          <p className="-ms-3 flex flex-wrap t-meta text-fg-2" data-today-meta="">
            {/* Узкая строка: срок первым, как колонка срока на широкой. */}
            {when?.text || phoneWord ? (
              <span className={`${PIECE} shrink-0 whitespace-nowrap${wide(" @min-[32rem]:hidden")} ${when?.overdue ? "text-danger" : ""}`}>
                {when?.text ? <time dateTime={when.dateTime ?? undefined} className="font-mono tabular-nums">{when.text}</time> : null}
                {phoneWord ? <span>{phoneWord}</span> : null}
              </span>
            ) : null}
            {/* Причина «шаг просрочен · ждёт принятия» — по части на слово: на узкой
                строке переносится целая часть, а не обрывок, и разделитель не
                остаётся висеть в конце строки. */}
            {(hideReason ? [] : item.reason.split(" · ")).map((part, index) => (
              <span key={`${index}:${part}`} className={`${PIECE} order-1 max-w-full${wide(" @min-[32rem]:order-2")}`} data-today-reason="">{part}</span>
            ))}
            {item.who ? (
              <span className={`${PIECE} order-2 min-w-[5.5rem] flex-1 basis-0${wide(" @min-[32rem]:order-1 @min-[32rem]:min-w-0 @min-[32rem]:max-w-full @min-[32rem]:flex-initial @min-[32rem]:basis-auto")}`}>
                {/* Рамка фокуса внутрь: у края обрезанной строки внешняя срезалась бы. */}
                <IntentPrefetchLink href={item.who.href} title={item.who.name}
                  className="relative z-10 hidden h-6 min-w-0 items-center rounded-nav underline-offset-2 hover:text-fg hover:underline focus-visible:outline-offset-[-2px] md:pointer-fine:flex">
                  <span className="truncate">{item.who.name}</span>
                </IntentPrefetchLink>
                <span className="min-w-0 truncate md:pointer-fine:hidden">{item.who.name}</span>
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        {dialLeadId && dial?.status === "ready" ? (
          <DialButton leadId={dialLeadId} mapped={dial.mapped} variant="row" subject={item.who?.name ?? item.title} sharedHint />
        ) : null}
        <IntentPrefetchLink
          href={item.openHref}
          data-queue-open=""
          aria-label={`Открыть: ${item.title}${item.who ? ` — ${item.who.name}` : ""}`}
          className={`grid min-h-11 min-w-11 place-items-center rounded-nav t-label text-fg-2 before:absolute before:inset-0 before:content-[''] hover:text-fg${wide(" @min-[32rem]:px-3 @min-[32rem]:underline @min-[32rem]:underline-offset-4")}`}
        >
          <span aria-hidden="true" className={`hidden${wide(" @min-[32rem]:inline")}`}>Открыть</span>
          <Icon name="chevron-right" size={20} className={wide("@min-[32rem]:hidden")} />
        </IntentPrefetchLink>
      </div>
    </li>
  );
}
