import { SkeletonBlock } from "@/components/ui";

const TITLE_WIDTHS = ["w-7/12", "w-5/12", "w-1/2", "w-2/3"];
const TREE_WIDTHS = ["w-32", "w-24", "w-28", "w-20"];

/**
 * Загрузка таблицы материалов — волосяные строки той же высоты (44 px), без
 * текста-заглушки. Строки таблицы: рисуются внутри `<tbody>`.
 */
export function KnowledgeRowsSkeleton({ rows = 6 }: Readonly<{ rows?: number }>) {
  return <>
    {Array.from({ length: rows }, (_, index) => (
      <tr key={index} aria-hidden="true" className="border-b border-border" data-testid="knowledge-skeleton-row">
        <td className="w-11 p-0"><span className="grid size-11 place-items-center"><SkeletonBlock className="size-[18px] rounded-nav" /></span></td>
        <td className="py-3.5 pe-3"><SkeletonBlock className={`h-3.5 rounded-nav ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`} /></td>
        <td className="hidden py-3.5 pe-3 @xl/kbl:table-cell"><SkeletonBlock className="h-3.5 w-16 rounded-nav" /></td>
        <td className="py-3.5 ps-3 text-end"><SkeletonBlock className="ms-auto h-3.5 w-11 rounded-nav" /></td>
      </tr>
    ))}
  </>;
}

/** Загрузка дерева: строки 44 px с местом под стрелку. */
export function KnowledgeTreeSkeleton({ rows = 5 }: Readonly<{ rows?: number }>) {
  return (
    <ul aria-hidden="true" className="space-y-0.5" data-testid="knowledge-tree-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex min-h-11 items-center gap-2 ps-11">
          <SkeletonBlock className={`h-3.5 rounded-nav ${TREE_WIDTHS[index % TREE_WIDTHS.length]}`} />
        </li>
      ))}
    </ul>
  );
}

/** Первая загрузка страницы (Suspense): форма будущего листа — дерево, строка инструментов, строки. */
export function KnowledgeLibrarySkeleton() {
  return (
    <div aria-busy="true" className="@container/kb rounded-card border border-border bg-surface" data-testid="knowledge-skeleton">
      <p role="status" className="sr-only">Загружаем базу знаний…</p>
      <div className="grid @3xl/kb:grid-cols-[16rem_minmax(0,1fr)] @5xl/kb:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="hidden border-e border-border p-3 @3xl/kb:block"><KnowledgeTreeSkeleton rows={7} /></div>
        <div className="@container/kbl min-w-0 space-y-3 p-4 @3xl/kb:p-5">
          <SkeletonBlock className="h-5 w-48 rounded-nav" />
          <div className="flex gap-2">
            <SkeletonBlock className="h-11 min-w-0 flex-1 rounded-ctl" />
            <SkeletonBlock className="h-11 w-28 rounded-ctl" />
            <SkeletonBlock className="h-11 w-11 rounded-ctl" />
          </div>
          <table className="w-full border-collapse"><tbody><KnowledgeRowsSkeleton /></tbody></table>
        </div>
      </div>
    </div>
  );
}
