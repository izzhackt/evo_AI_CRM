"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

/**
 * Воронка продаж: колонка на стадию, карточка на лида.
 *
 * Карточка намеренно маленькая и несёт почти только имя — в очереди человека
 * узнают по имени, а не по идентификатору. Всё остальное живёт в Lead 360,
 * куда карточка и ведёт.
 *
 * Чем отличается от референса и почему:
 *
 * 1. В колонках нет денег. В референсе над каждой стадией стоит сумма, но
 *    сделок с суммами у EVO не существует — вместо выдуманной цифры счёт лидов.
 * 2. Цветной уголок референса заменён отметкой о следующем действии. Уголок там
 *    ничего не называет; здесь метка говорит то, что решает: срок прошёл, срок
 *    сегодня, действие не назначено.
 * 3. `handoff_ready` — гейт, а не ещё одна колонка. Это единственное место, где
 *    sales передаёт работу admissions, и решение там принимает человек. Он
 *    отмечен пилюлей: в этом мире цвет означает статус записи, поэтому
 *    подкрашивать саму колонку нельзя.
 *
 * Перенос сделан кнопкой, а не только перетаскиванием: перетаскивание без
 * клавиатурного пути — недоступный интерфейс (SC 2.1.1). Список стадий
 * раскрывается внутри карточки, а не всплывает над ней: доска — контейнер с
 * горизонтальной прокруткой, и всплывающий список обрезался бы её краем.
 */

export type PipelineStage = Readonly<{
  key: string;
  title: string;
  /** Гейт передачи: единственная стадия, где решение принимает человек. */
  gate: boolean;
  /** Выход из воронки. На таких стадиях следующего действия и не должно быть. */
  terminal: boolean;
}>;

export type PipelineLead = Readonly<{
  id: string;
  name: string;
  stageKey: string;
  /** Есть в модели, намеренно не рисуется — см. LeadCard. */
  source: string;
  /** Что делать дальше. null — не назначено, и это само по себе сигнал. */
  nextAction: string | null;
  /** Срок следующего действия, «02.09». null — срока нет. */
  nextActionAt: string | null;
  /** Состояние срока — считает сервер, у него единственный часовой пояс. */
  due: "overdue" | "today" | "later" | "none";
  href: string;
}>;

const DUE_MARK: Record<PipelineLead["due"], { tone: string; label: string } | null> = {
  overdue: { tone: "bg-danger", label: "срок прошёл" },
  today: { tone: "bg-warn", label: "срок сегодня" },
  later: null,
  none: { tone: "bg-control-edge", label: "следующее действие не назначено" },
};

function LeadCard({
  lead,
  stages,
  terminal,
  onMove,
}: {
  lead: PipelineLead;
  stages: readonly PipelineStage[];
  terminal: boolean;
  onMove: (leadId: string, stageKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // На «Переданы» и «Отказ» отсутствие следующего действия — норма, а не
  // сигнал. Метка там означала бы тревогу, которой нет.
  const mark = terminal && lead.due === "none" ? null : DUE_MARK[lead.due];

  return (
    <div className="relative rounded-ctl border border-border bg-surface px-3 py-2.5 focus-within:border-control-edge hover:border-control-edge">
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1">
          {/* Растянутая псевдоподложка делает кликабельной всю карточку, но
              ссылка остаётся ссылкой: кнопка внутри <a> — невалидная разметка
              и сломанное нажатие. */}
          <Link
            href={lead.href}
            /* Без этого Next тянет RSC каждой карточки при загрузке доски: на
               19 лидах это 19 запросов к тяжёлому Lead 360, а лидов будут
               сотни. Профиль грузится по нажатию. */
            prefetch={false}
            className="block text-sm font-semibold leading-5 text-fg after:absolute after:inset-0 after:content-['']"
          >
            {lead.name}
          </Link>
          {/* Источник (`whatsapp` / `website` / `referral`) убран с карточки:
              это ключ из базы, и на карточке просили только имя. Поле остаётся
              в модели. См. docs/design/v3/frontend-rules.md. */}
          {lead.nextActionAt ? (
            <span className="mt-0.5 block truncate text-2xs text-fg-3">
              {lead.nextActionAt}
            </span>
          ) : null}
        </p>

        {mark ? (
          <>
            <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${mark.tone}`} />
            <span className="sr-only">{mark.label}</span>
          </>
        ) : null}

        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((value) => !value)}
          title="Перенести на другую стадию"
          className="relative z-10 -me-1.5 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-nav text-fg-3 hover:bg-surface-2 hover:text-fg-2"
        >
          <span className="sr-only">Перенести «{lead.name}» на другую стадию</span>
          {/* ☰ — привычный знак ручки переноса. Шеврон здесь читался бы как
              «открыть» и спорил бы со ссылкой на профиль. */}
          <Icon name={open ? "x" : "menu"} size={15} />
        </button>
      </div>

      {open ? (
        <ul id={listId} className="relative z-10 mt-2 flex flex-col border-t border-border pt-1.5">
          {stages
            .filter((stage) => stage.key !== lead.stageKey)
            .map((stage) => (
              <li key={stage.key}>
                <button
                  type="button"
                  onClick={() => {
                    onMove(lead.id, stage.key);
                    setOpen(false);
                  }}
                  className="min-h-8 w-full rounded-nav px-2 text-start text-2xs text-fg-2 hover:bg-surface-2 hover:text-fg"
                >
                  {stage.title}
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Pipeline({
  stages,
  leads,
}: {
  stages: readonly PipelineStage[];
  leads: readonly PipelineLead[];
}) {
  const [moved, setMoved] = useState<Readonly<Record<string, string>>>({});
  const stageOf = (lead: PipelineLead) => moved[lead.id] ?? lead.stageKey;
  const move = (leadId: string, stageKey: string) =>
    setMoved((current) => ({ ...current, [leadId]: stageKey }));

  return (
    /*
     * Колонка — 280px. Уже — и «Ahmed Bin Khalid Al-Suwaidi» разваливается на
     * три строки, а карточка перестаёт быть маленькой. Шесть таких колонок не
     * влезают в экран, и доска едет вбок: так работает любая канбан-доска, и
     * прокрутка заперта внутри размеченной области, а не у всей страницы.
     *
     * На телефоне доски нет вовсе: всё, что там можно было бы делать, — возить
     * экран вбок. Колонки становятся секциями во всю ширину.
     */
    <div
      role="group"
      aria-label="Воронка продаж"
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-card"
    >
      <ol className="flex flex-col gap-3 @2xl:w-max @2xl:flex-row md:items-start">
        {stages.map((stage) => {
          const inStage = leads.filter((lead) => stageOf(lead) === stage.key);
          return (
            <li
              key={stage.key}
              className="flex min-w-0 flex-col gap-2 rounded-card bg-surface-2 p-2.5 @2xl:w-[280px] md:shrink-0"
            >
              <div className="flex items-center justify-between gap-2 px-1 py-0.5">
                <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-fg">
                  <span className="truncate">{stage.title}</span>
                  {/* Гейт отмечен пилюлей, а не подкрашенной колонкой: цвет в
                      этом мире занят статусами, и подложка стадии его бы
                      переопределила. */}
                  {stage.gate ? <Pill tone="solid">гейт</Pill> : null}
                </h3>
                <span className="shrink-0 font-mono text-2xs text-fg-3">{inStage.length}</span>
              </div>

              <ul className="flex flex-col gap-2">
                {inStage.map((lead) => (
                  <li key={lead.id}>
                    <LeadCard
                      lead={{ ...lead, stageKey: stageOf(lead) }}
                      stages={stages}
                      terminal={stage.terminal}
                      onMove={move}
                    />
                  </li>
                ))}
                {inStage.length === 0 ? (
                  <li className="px-1 py-2 text-2xs text-fg-3">Пусто</li>
                ) : null}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
