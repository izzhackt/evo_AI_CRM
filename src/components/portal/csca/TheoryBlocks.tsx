import type { Locale } from "@/lib/i18n-data";
import type { PortalStrings } from "@/lib/portal/i18n";
import type { CscaCell, CscaFigure, CscaTheoryBlock } from "@/lib/portal/csca";

import { Figure } from "./Figure";
import { MathText, TexDisplay, TexInline } from "./MathText";
import { StepReveal } from "./StepReveal";

type Strings = PortalStrings<"csca">;

export function theoryBlockId(index: number): string {
  return `cs-block-${index + 1}`;
}

/** Подпись блока для оглавления урока. */
export function theoryBlockLabel(block: CscaTheoryBlock, strings: Strings, locale: Locale): string {
  switch (block.kind) {
    case "example":
      return locale === "ky" ? block.title_ky : block.title_ru;
    case "interactive":
      return strings["block.figure"];
    default:
      return strings[`block.${block.kind}`];
  }
}

function Cell({ cell, locale }: { cell: CscaCell; locale: Locale }) {
  if ("tex" in cell) return <TexInline tex={cell.tex} />;
  return <MathText text={locale === "ky" ? cell.ky : cell.ru} />;
}

function NoCalculatorIcon() {
  return (
    <svg className="cs-tip-icon" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="6.5" y="3.5" width="15" height="21" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="6.5" width="9" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 14.5h.01M14 14.5h.01M18 14.5h.01M10 18.5h.01M14 18.5h.01M18 18.5h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M4 25 24 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PitfallIcon() {
  return (
    <svg className="cs-pitfall-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5.2v4.6M9 12.6h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Блоки теории урока CSCA (контракт §13): каждый вид своей разметкой.
 * Рисунок стоит там, где его поставил автор, рядом с идеей, которую он
 * поясняет. Блок без рисунка в выдаче (сбой контента) пропускается.
 */
export function TheoryBlocks({
  blocks,
  figures,
  locale,
  strings,
}: {
  blocks: CscaTheoryBlock[];
  figures: Record<string, CscaFigure>;
  locale: Locale;
  strings: Strings;
}) {
  const ky = locale === "ky";
  return (
    <>
      {blocks.map((block, index) => {
        const id = theoryBlockId(index);
        switch (block.kind) {
          case "idea":
            return <MathText key={id} id={id} as="p" className="cs-idea" text={ky ? block.ky : block.ru} />;
          case "formula":
            return (
              <section key={id} id={id} className="cs-formula" aria-label={strings["block.formula"]}>
                <div className="cs-formula-lines">
                  {block.tex.map((tex, line) => <TexDisplay key={line} tex={tex} />)}
                </div>
                <MathText as="p" className="cs-formula-note" text={ky ? block.note_ky : block.note_ru} />
              </section>
            );
          case "figure":
          case "interactive": {
            const figureKey = block.figure_key;
            const figure = figureKey ? figures[figureKey] : undefined;
            if (!figure) return null;
            return (
              <div key={id} id={id} className="cs-block-figure">
                <Figure
                  figure={figure}
                  locale={locale}
                  caption={<MathText text={ky ? block.caption_ky : block.caption_ru} />}
                  scrollHint={strings.figureScrolls}
                />
              </div>
            );
          }
          case "table":
            return (
              <div key={id} id={id} className="cs-table-wrap" role="region" aria-label={ky ? block.caption_ky : block.caption_ru} tabIndex={0}>
                <table className="cs-table">
                  <caption>
                    <MathText text={ky ? block.caption_ky : block.caption_ru} />
                  </caption>
                  <thead>
                    <tr>
                      {block.header.map((cell, column) => (
                        <th key={column} scope="col"><Cell cell={cell} locale={locale} /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, column) => column === 0
                          ? <th key={column} scope="row"><Cell cell={cell} locale={locale} /></th>
                          : <td key={column}><Cell cell={cell} locale={locale} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "example":
            return (
              <section key={id} id={id} className="cs-example" aria-labelledby={`${id}-title`}>
                <h2 id={`${id}-title`} className="cs-example-title">{ky ? block.title_ky : block.title_ru}</h2>
                <MathText as="p" className="cs-example-stem" lang="en" text={block.stem_en} />
                <StepReveal
                  steps={block.steps}
                  answer={ky ? block.answer_ky : block.answer_ru}
                  strings={strings}
                  locale={locale}
                />
              </section>
            );
          case "pitfalls":
            return (
              <section key={id} id={id} className="cs-pitfalls" aria-labelledby={`${id}-title`}>
                <h2 id={`${id}-title`} className="cs-block-title">{strings["block.pitfalls"]}</h2>
                <ul className="cs-pitfalls-list">
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      <PitfallIcon />
                      <MathText text={ky ? item.ky : item.ru} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          case "tip":
            return (
              <aside key={id} id={id} className="cs-tip" aria-label={strings["block.tip"]}>
                <NoCalculatorIcon />
                <div>
                  <p className="cs-tip-title">{strings["block.tip"]}</p>
                  <MathText as="p" className="cs-tip-text" text={ky ? block.ky : block.ru} />
                </div>
              </aside>
            );
          case "terms":
            return (
              <section key={id} id={id} className="cs-terms" aria-labelledby={`${id}-title`}>
                <h2 id={`${id}-title`} className="cs-block-title">{strings["block.terms"]}</h2>
                <dl className="cs-terms-list">
                  {block.terms.map((term) => (
                    <div key={term.en} className="cs-term">
                      <dt lang="en">{term.en}</dt>
                      <dd>{ky ? term.ky : term.ru}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
