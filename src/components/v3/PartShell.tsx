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
  lead,
  width = "wide",
  children,
}: {
  title: string;
  /** Размер того, что показано. null — считать нечего. */
  count?: number | null;
  lead: string;
  width?: "wide" | "narrow";
  children: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full px-4 py-8 sm:px-6 ${
        width === "narrow" ? "max-w-[860px]" : "max-w-[1240px]"
      }`}
    >
      <h1 className="flex flex-wrap items-baseline gap-2.5 text-2xl font-semibold tracking-[-0.02em] text-fg">
        {title}
        {typeof count === "number" ? (
          <span className="font-mono text-xl font-normal tabular-nums text-fg-3">{count}</span>
        ) : null}
      </h1>
      <p className="mt-1 max-w-[62ch] text-sm leading-6 text-fg-3">{lead}</p>

      <div className="mt-6">{children}</div>
    </main>
  );
}
