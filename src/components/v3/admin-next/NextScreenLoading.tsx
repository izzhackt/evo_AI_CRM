/**
 * Скелет, пока грузится код экрана нового вида («Настройки», «Маркетинг», «Финансы», «ИИ-агент»). Его держит сам вход
 * (`loading` у `next/dynamic`), а не `loading.tsx` маршрута: файл маршрута давал бы скелет и ответ 200 вместо 307/404 и сотрудникам с прежним видом.
 * Без импортов: вход лежит в первой загрузке маршрута, и склейка классов (`cn` → `tailwind-merge`, ≈8 КБ gzip) или виджеты набора туда не идут.
 * Те же классы, что у примитива `Skeleton`.
 */
const BLOCK = "animate-pulse rounded-ctl bg-surface-2";

export function NextScreenLoading({ label }: Readonly<{ label: string }>) {
  return (
    <main data-slot="next-screen-loading" aria-busy="true" className="mx-auto grid w-full max-w-[1240px] gap-4 px-4 py-8 sm:px-6">
      <p role="status" className="sr-only">{label}</p>
      <div aria-hidden="true" className={`${BLOCK} h-11 w-full max-w-md`} />
      <div aria-hidden="true" className={`${BLOCK} h-64`} />
    </main>
  );
}
