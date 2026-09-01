/**
 * Календарь сотрудника: месяц слева, работа справа.
 *
 * Форма собрана из двух референсов: месяц с точками на днях, где есть работа,
 * и колонка, сгруппированная по срочности — «эта неделя / этот месяц / без даты».
 * Строка задачи показывает, кто её поставил, потому что «поставил директор» и
 * «поставил себе» — это разные вещи, и человек должен различать их не вчитываясь.
 *
 * ДАННЫЕ. Компонент ничего не знает о базе и ничего не хранит: он рисует то,
 * что ему передали. Когда платформа будет готова, для этого экрана понадобится:
 *
 *   - сотрудник как сущность (сейчас в системе только три роли);
 *   - у задачи исполнитель-человек рядом с ролью, чтобы «поставить Ивану»
 *     отличалось от «поставить на приёмную комиссию»;
 *   - у задачи автор, чтобы показывать «поставил директор»;
 *   - право задачи не быть привязанной к студенту — иначе личную задачу
 *     вроде «позвонить в вуз» некуда положить.
 *
 * Ничего из этого компонент не требует прямо сейчас: недостающее приходит как
 * null и просто не рисуется.
 */

export type TaskUrgency = "week" | "month" | "later" | "unscheduled";

export type CalendarTask = Readonly<{
  id: string;
  title: string;
  /** ISO-дата. null — работа без срока, она не пропадает, а уходит в свою группу. */
  dueAt: string | null;
  /** Кто поставил. null, пока в системе нет авторства. */
  assignedBy: string | null;
  /** Кому. null, пока задача адресована роли, а не человеку. */
  assignedTo: string | null;
  /** Роль-владелец — есть всегда. */
  ownerRole: string;
  done: boolean;
  /** Куда ведёт задача. null для личной, не привязанной к студенту. */
  href: string | null;
}>;

export type CalendarDay = Readonly<{
  /** День месяца. */
  date: number;
  /** false для дней соседних месяцев в сетке. */
  inMonth: boolean;
  today: boolean;
  /** Сколько работы на этот день — точка под числом. */
  count: number;
}>;

const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

const GROUP_TITLES: Record<TaskUrgency, string> = {
  week: "Эта неделя",
  month: "Этот месяц",
  later: "Позже",
  unscheduled: "Без срока",
};

function formatDue(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

function TaskRow({ task }: { task: CalendarTask }) {
  const due = formatDue(task.dueAt);
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border ${
          task.done
            ? "border-accent bg-accent text-on-accent"
            : "border-control-edge"
        }`}
      >
        {task.done ? (
          <svg viewBox="0 0 10 8" className="h-2 w-2.5" aria-hidden="true">
            <path
              d="M1 4l2.5 2.5L9 1"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
      </span>

      <span className="min-w-0">
        <span
          className={`block text-sm leading-5 ${
            task.done ? "text-fg-3 line-through" : "text-fg"
          }`}
        >
          {task.title}
        </span>

        {/* Срок и авторство — приглушённо: это опора, а не заголовок. */}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-3">
          {due ? <span className="font-mono">{due}</span> : null}
          {task.assignedBy ? <span>поставил {task.assignedBy}</span> : null}
          {!task.assignedTo ? (
            <span className="text-fg-3">на роли {task.ownerRole}</span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

export function WorkCalendar({
  monthLabel,
  year,
  days,
  groups,
  personName,
}: {
  monthLabel: string;
  year: number;
  days: readonly CalendarDay[];
  /** Порядок групп задаёт вызывающий: срочность — его решение, не наше. */
  groups: readonly Readonly<{ urgency: TaskUrgency; tasks: readonly CalendarTask[] }>[];
  /** Чей это календарь. Пока сотрудников нет — название роли. */
  personName: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <section aria-label={`Календарь: ${monthLabel} ${year}`}>
        <h3 className="mb-3 text-md font-bold text-fg">
          {monthLabel} <span className="font-medium text-fg-3">{year}</span>
        </h3>

        <div className="grid grid-cols-7 gap-1" role="presentation">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="pb-1 text-center font-mono text-2xs tracking-[0.08em] text-fg-3"
            >
              {day}
            </div>
          ))}
        </div>

        <ol className="mt-1 grid grid-cols-7 gap-1">
          {days.map((day, index) => (
            <li
              key={`${day.date}-${index}`}
              aria-current={day.today ? "date" : undefined}
              className={`relative grid aspect-square place-items-center rounded-nav text-sm ${
                !day.inMonth
                  ? "text-fg-3"
                  : day.today
                    ? "bg-accent font-bold text-on-accent"
                    : "bg-surface-2 text-fg"
              }`}
            >
              {day.date}
              {day.count > 0 && day.inMonth ? (
                <>
                  <span
                    aria-hidden="true"
                    className={`absolute top-1.5 h-1 w-1 rounded-full ${
                      day.today ? "bg-on-accent" : "bg-accent"
                    }`}
                  />
                  {/* Точка — украшение; счётчик читается вслух отсюда. */}
                  <span className="sr-only">, работы: {day.count}</span>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label={`Работа: ${personName}`} className="flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.urgency}>
            <h3 className="flex items-center justify-between border-b border-border pb-1.5 text-sm font-semibold text-fg-2">
              {GROUP_TITLES[group.urgency]}
              <span className="font-mono text-xs font-normal text-fg-3">
                {group.tasks.length}
              </span>
            </h3>
            {group.tasks.length === 0 ? (
              <p className="py-3 text-sm text-fg-3">Пусто</p>
            ) : (
              <ul className="mt-1">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
