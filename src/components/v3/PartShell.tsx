import Link from "next/link";

/**
 * Общая обёртка части V3.
 *
 * Из референса: заголовок и рядом с ним — приглушённое число («People 2,942»).
 * Счёт стоит в заголовке, а не отдельной плашкой-метрикой: это не показатель,
 * а размер того, на что смотришь.
 *
 * Шапка одна на все части, потому что в прототипе они идут подряд, и своя
 * вёрстка заголовка у каждой читалась бы как разные продукты.
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
      <Link
        href="/v3"
        className="-ms-1 inline-flex min-h-11 items-center px-1 font-mono text-xs text-fg-2 underline decoration-border-strong underline-offset-4 hover:decoration-fg-2"
      >
        ← Части интерфейса
      </Link>

      <h1 className="mt-3 flex flex-wrap items-baseline gap-2.5 text-2xl font-semibold tracking-[-0.02em] text-fg">
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
