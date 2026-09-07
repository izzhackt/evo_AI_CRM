export default function StudentPortalLoading() {
  return (
    <main
      className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6 sm:py-10"
      aria-busy="true"
      aria-label="Загружаем кабинет студента"
    >
      <div className="h-3 w-28 rounded bg-surface-3" />
      <div className="mt-3 h-8 w-56 max-w-full rounded bg-surface-3" />
      <div className="mt-3 h-4 w-[520px] max-w-full rounded bg-surface-3" />
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded-card border border-border bg-surface" />
        <div className="h-48 rounded-card border border-border bg-surface" />
      </div>
      <span className="sr-only">Загрузка…</span>
    </main>
  );
}
