/**
 * Загрузка раздела кабинета: заглушка по форме страницы «Атласа» (заголовок и
 * ряд карточек) на тех же отступах `.pt-page`, чтобы подмена на готовое
 * содержимое была спокойнее. data-pt-loading включает в portal.css мягкое
 * проявление заглушки; она не пульсирует, ничего не зацикливается.
 */
export default function StudentPortalLoading() {
  // Скелет на портальных токенах (--pt-skeleton): в тёмной теме не светлые
  // v3-блоки на тёмном фоне, в светлой — тон бумаги, а не холодный серый.
  return (
    <main
      className="pt-boundary pt-page"
      data-pt-loading=""
      aria-busy="true"
      aria-label="Загружаем кабинет студента"
    >
      <div className="pt-page-header" aria-hidden="true">
        <span className="pt-skeleton pt-skeleton-kicker" />
        <span className="pt-skeleton pt-skeleton-title" />
        <span className="pt-skeleton pt-skeleton-lead" />
      </div>
      <div className="pt-skeleton-grid" aria-hidden="true">
        <span className="pt-skeleton pt-skeleton-card" />
        <span className="pt-skeleton pt-skeleton-card" />
        <span className="pt-skeleton pt-skeleton-card" />
      </div>
      <p role="status" className="pt-page-lead">Загружаем данные… Можно перейти в другой раздел.</p>
    </main>
  );
}
