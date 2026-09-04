/**
 * Панель профиля: заголовок-полоска и содержимое под ней.
 *
 * Лежит отдельным файлом, потому что её просят и серверные вкладки, и
 * клиентские «Документы». Если бы она осталась внутри `tabs.tsx`, клиентская
 * вкладка тянула бы в браузер весь остальной профиль ради одной рамки.
 */
export function Card({
  id,
  title,
  aside,
  children,
}: {
  id?: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-card border border-border bg-surface">
      <h3 className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-fg-2">
        {title}
        {aside ? <span className="font-normal normal-case tracking-normal">{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}
