import type { ReactNode } from "react";

export type DueBandView = Readonly<{
  key: string;
  label: string;
  /** Число строк группы — только при полном чтении; null — числа нет. */
  count: number | null;
  /** «Просрочено»: слово окрашено, но смысл несёт само слово. */
  danger: boolean;
  /** Тихая строка под заголовком: почему у группы нет числа при полном чтении. */
  note?: string | null;
  rows: ReactNode;
}>;

/**
 * Тело очереди: группы по сроку с липкими заголовками на волосяной линии,
 * строки — список без карточек. Заголовок группы — h2 страницы.
 */
export function DueBands({ bands, idPrefix = "queue-band" }: Readonly<{ bands: readonly DueBandView[]; idPrefix?: string }>) {
  return (
    <div className="space-y-2" data-queue-list="">
      {bands.map((band) => {
        const headingId = `${idPrefix}-${band.key}`;
        return (
          <section key={band.key} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className="sticky top-0 z-20 flex items-baseline gap-1.5 bg-bg py-2 ps-3 t-item shadow-[inset_0_-1px_0_var(--border)]"
            >
              <span className={band.danger ? "text-danger" : "text-fg"}>{band.label}</span>
              {band.count !== null ? <span className="font-normal tabular-nums text-fg-3">· {band.count}</span> : null}
            </h2>
            {band.note ? <p className="border-b border-border py-2 ps-3 t-meta text-fg-2">{band.note}</p> : null}
            <ul>{band.rows}</ul>
          </section>
        );
      })}
    </div>
  );
}
