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
  width?: "wide" | "narrow";
  /** Экран занимает высоту окна: список и лента прокручиваются внутри себя. */
  fill?: boolean;
  children: React.ReactNode;
}) {
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
