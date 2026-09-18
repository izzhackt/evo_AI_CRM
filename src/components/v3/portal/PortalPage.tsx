export function PortalPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6 sm:py-10">
      <header className="max-w-[820px]">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-fg-3">
          Кабинет студента
        </p>
        <h1 className="mt-2 text-[27px] font-semibold leading-[1.2] tracking-[-0.03em] text-fg sm:text-[32px]">
          {title}
        </h1>
        <p className="mt-2 max-w-[74ch] text-sm leading-6 text-fg-3">{description}</p>
      </header>
      <div className="mt-6 min-w-0">{children}</div>
    </main>
  );
}

export function PortalEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-card border border-border bg-surface px-5 py-10 text-center">
      <h2 className="text-md font-semibold text-fg">{title}</h2>
      <p className="mx-auto mt-2 max-w-[560px] text-sm leading-6 text-fg-3">
        {description}
      </p>
    </section>
  );
}

export function PortalSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="break-words text-md font-semibold text-fg">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-5 text-fg-3">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function PortalDefinition({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-fg-3">{term}</dt>
      <dd className="mt-1 text-sm font-medium leading-6 text-fg">{children}</dd>
    </div>
  );
}
