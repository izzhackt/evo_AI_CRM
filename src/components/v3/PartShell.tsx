/**
 * Общая обёртка части V3.
 *
 * Из референса: заголовок и рядом с ним — приглушённое число («People 2,942»).
 * Счёт стоит в заголовке, а не отдельной плашкой-метрикой: это не показатель,
 * а размер того, на что смотришь.
 *
 * Шапка одна на все разделы: своя вёрстка заголовка у каждого читалась бы
 * как разные продукты. Возврата «к списку частей» здесь нет — разделы стоят
 * в навигации оболочки.
 */
export function PartShell({
  title,
  count,
  width = "wide",
  fill = false,
  children,
}: {
  title: string;
  /** Размер того, что показано. null — считать нечего. */
  count?: number | null;
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
      <h1 className="flex flex-wrap items-baseline gap-2.5 text-2xl font-semibold tracking-[-0.02em] text-fg">
        {title}
        {typeof count === "number" ? (
          <span className="font-mono text-xl font-normal tabular-nums text-fg-3">{count}</span>
        ) : null}
      </h1>

      <div className={fill ? "mt-5 flex min-h-0 flex-1 flex-col" : "mt-6"}>{children}</div>
    </main>
  );
}
