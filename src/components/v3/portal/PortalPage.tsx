import styles from "./PortalShell.module.css";

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
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.pageEyebrow}>
          Кабинет студента
        </p>
        <h1 className={styles.pageTitle}>
          {title}
        </h1>
        <p className={styles.pageDescription}>{description}</p>
      </header>
      <div className={styles.pageBody}>{children}</div>
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
