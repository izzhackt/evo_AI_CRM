export default function StudentPortalLoading() {
  // Скелет на портальных токенах (--pt-skeleton): в тёмной теме не светлые
  // v3-блоки на тёмном фоне, в светлой — тон бумаги, а не холодный серый.
  return (
    <main
      className="pt-boundary mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6 sm:py-10"
      aria-busy="true"
      aria-label="Загружаем кабинет студента"
    >
      <div aria-hidden="true" className="pt-skeleton h-3 w-28" />
      <div aria-hidden="true" className="pt-skeleton mt-3 h-8 w-56 max-w-full" />
      <div aria-hidden="true" className="pt-skeleton mt-3 h-11 w-64 max-w-full" />
      <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div aria-hidden="true" className="pt-skeleton h-80" />
        <div aria-hidden="true" className="pt-skeleton h-80" />
      </div>
      <p role="status" className="pt-boundary-muted mt-5 text-sm">Загружаем данные… Можно перейти в другой раздел.</p>
    </main>
  );
}
