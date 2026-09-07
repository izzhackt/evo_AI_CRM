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
      <header className="max-w-[720px]">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-fg-3">
          Кабинет студента
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-fg-2">{description}</p>
      </header>
      <div className="mt-7">{children}</div>
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
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-md font-semibold text-fg">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-fg-3">{description}</p>
        ) : null}
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
