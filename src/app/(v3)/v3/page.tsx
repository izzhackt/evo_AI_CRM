import Link from "next/link";

export const metadata = { title: "V3 · Каталог частей" };

/**
 * Каталог, а не страница.
 *
 * Части нового интерфейса собираются по одной и смотрятся по одной: в продукт
 * они пойдут в разные места, и любая их совместная раскладка здесь была бы
 * случайной композицией, которую потом пришлось бы разбирать.
 */
const PARTS = [
  {
    href: "/v3/main",
    name: "Главная страница",
    note: "Приветствие, метрики, динамика и воронка — раскладка из референса.",
    state: "метрики и воронка на реальных данных",
  },
  {
    href: "/v3/funnel",
    name: "Воронка поступления",
    note: "Ступени и конверсия. Читает настоящую PostgreSQL.",
    state: "на реальных данных",
  },
  {
    href: "/v3/pipeline",
    name: "Воронка продаж",
    note: "Стадии, лиды в них, гейт передачи. Карточка ведёт в профиль.",
    state: "на реальных данных",
  },
  {
    href: "/v3/inbox",
    name: "Входящие",
    note: "Диалоги WhatsApp и переписка. Ответов нет — отправлять пока нечем.",
    state: "на реальных данных",
  },
  {
    href: "/v3/student",
    name: "Студент 360",
    note: "Один кейс целиком: стоп, что дальше, заявка, виза, история.",
    state: "на реальных данных",
  },
  {
    href: "/v3/tasks",
    name: "Задачи",
    note: "Очередь приёмной кампании по срочности.",
    state: "на реальных данных",
  },
  {
    href: "/v3/settings",
    name: "Настройки",
    note: "Роли, права и состояние интеграций. Без переключателей.",
    state: "на реальных данных",
  },
  {
    href: "/v3/knowledge",
    name: "База знаний",
    note: "Файлы бизнеса: дерево папок, поиск, выбор строк.",
    state: "форма готова, данные — образец",
  },
  {
    href: "/v3/calendar",
    name: "Календарь сотрудника",
    note: "Месяц с точками и работа, сгруппированная по срочности.",
    state: "форма готова, данные — образец",
  },
] as const;

export default function V3Catalogue() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        Части интерфейса
      </h1>
      <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
        Каждая смотрится отдельно. В продукт они пойдут в разные места, поэтому
        здесь они не составляются в страницу.
      </p>

      <ul className="mt-7 flex flex-col gap-px overflow-hidden rounded-card border border-border bg-border">
        {PARTS.map((part) => (
          <li key={part.href} className="bg-surface">
            <Link
              href={part.href}
              className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface-2"
            >
              <span className="min-w-0">
                <span className="block text-md font-bold text-fg">{part.name}</span>
                <span className="mt-0.5 block max-w-[56ch] text-sm leading-5 text-fg-3">
                  {part.note}
                </span>
              </span>
              <span className="shrink-0 font-mono text-2xs uppercase tracking-wide text-fg-3">
                {part.state}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
