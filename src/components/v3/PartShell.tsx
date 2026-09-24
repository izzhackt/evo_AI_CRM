import { PageHeader } from "@/components/ui";

/**
 * Общая обёртка части V3.
 *
 * Заголовок отдан общему `PageHeader`: из референса — рядом с заголовком
 * приглушённое число («People 2,942»). Счёт стоит в заголовке, а не отдельной
 * плашкой-метрикой: это не показатель, а размер того, на что смотришь.
 * Необязательный `action` — единственное главное действие экрана, справа от
 * заголовка (красная кнопка или ссылка); второстепенные действия остаются в
 * содержимом.
 *
 * Шапка одна на все разделы: своя вёрстка заголовка у каждого читалась бы
 * как разные продукты. Возврата «к списку частей» здесь нет — разделы стоят
 * в навигации оболочки.
 *
 * `width="board"` — доски (решение владельца 25.09.2026): без ограничения
 * 1240 px и без центрирования, по левому краю. От 768 px экран занимает высоту
 * окна под верхней панелью (`AppShell` задаёт её на маршрутах досок): шапка и
 * строка инструментов стоят сверху, доска получает оставшуюся высоту, и её
 * колонки прокручиваются внутри себя, а не страница.
 */
export function PartShell({
  title,
  count,
  description,
  action,
  width = "wide",
  fill = false,
  children,
}: {
  title: string;
  /** Размер того, что показано. null — считать нечего. */
  count?: number | null;
  description?: string;
  action?: React.ReactNode;
  width?: "wide" | "narrow" | "board";
  /** Экран занимает высоту окна: список и лента прокручиваются внутри себя. */
  fill?: boolean;
  children: React.ReactNode;
}) {
  if (width === "board") {
    return (
      <main className="flex w-full min-w-0 flex-col px-4 pb-4 pt-5 sm:px-6 md:min-h-0 md:flex-1">
        <PageHeader title={title} count={count} description={description} action={action} />

        <div className="mt-4 flex min-w-0 flex-col md:min-h-0 md:flex-1">{children}</div>
      </main>
    );
  }

  return (
    <main
      className={`mx-auto w-full px-4 sm:px-6 ${
        width === "narrow" ? "max-w-[860px]" : "max-w-[1240px]"
      } ${fill ? "flex h-dvh flex-col py-6" : "py-8"}`}
    >
      <PageHeader title={title} count={count} description={description} action={action} />

      <div className={fill ? "mt-5 flex min-h-0 flex-1 flex-col" : "mt-6"}>{children}</div>
    </main>
  );
}
