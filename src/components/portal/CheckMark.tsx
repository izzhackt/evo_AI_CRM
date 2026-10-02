/**
 * Галочка подтверждения (анимации кабинета студента, PLAN_CHANGES 02.10).
 * Декоративна: смысл несёт соседний текст живой области, поэтому aria-hidden.
 * `fresh` — успех случился в этой сессии: portal.css (.pt-check[data-fresh])
 * дорисовывает штрих за --pt-motion-base; без `fresh` (состояние пришло с
 * сервера) галочка стоит сразу. При prefers-reduced-motion штриха нет вовсе.
 */
export function CheckMark({ fresh = false }: { fresh?: boolean }) {
  return (
    <svg
      className="pt-check"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      data-fresh={fresh ? "" : undefined}
    >
      <path
        className="pt-check-path"
        d="M3.5 8.4 6.6 11.5 12.5 5.2"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
