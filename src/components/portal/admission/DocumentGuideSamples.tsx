import type { DocumentGuideView } from "@/lib/portal/document-guides";
import type { PortalStrings } from "@/lib/portal/i18n";

import { DownloadIcon, ExpandIcon } from "./DocumentGuideIcons";

type Strings = PortalStrings<"admission">;
export type SampleCursor = Readonly<{ set: number; page: number }>;

/**
 * Образцы в панели «Образец и советы». Настоящие сканы (личные данные закрыты): наборы переключаются кнопками,
 * страница видна крупно, миниатюры с подписями («Оригинал», «Перевод», «Заверка нотариуса») под ней.
 * Нет настоящих образцов для страны — нарисованная схема с метками, как раньше.
 */
export function DocumentGuideSamples({
  guide,
  strings,
  titleId,
  cursor,
  onSelect,
  onOpen,
}: {
  guide: DocumentGuideView;
  strings: Strings;
  titleId: string;
  cursor: SampleCursor;
  onSelect: (cursor: SampleCursor) => void;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const sets = guide.sampleSets;
  const headingId = `${titleId}-sample`;
  if (sets.length === 0) {
    return (
      <section className="pt-doc-guide-sample" aria-labelledby={headingId}>
        <div className="pt-doc-guide-sample-head">
          <h3 id={headingId}>{strings.guideSample}</h3>
        </div>
        <button type="button" className="pt-doc-guide-hero" aria-label={strings.guideSampleOpen} onClick={(event) => onOpen(event.currentTarget)}>
          <SampleFigure guide={guide} />
          <span className="pt-doc-guide-zoom" aria-hidden="true"><ExpandIcon /></span>
        </button>
        <SampleLegend guide={guide} />
      </section>
    );
  }

  const set = sets[Math.min(cursor.set, sets.length - 1)];
  const pageIndex = Math.min(cursor.page, set.pages.length - 1);
  const page = set.pages[pageIndex];
  const many = set.pages.length > 1;
  // Бланк скачивается при любом выбранном наборе: шаг «Где взять» ссылается на эту кнопку.
  const download = sets.find((item) => item.download)?.download ?? null;
  const single = sets.length === 1 && !many;
  return (
    <section className="pt-doc-guide-sample" aria-labelledby={headingId}>
      <div className="pt-doc-guide-sample-head">
        <h3 id={headingId}>{single ? strings.guideSample : strings.guideSamples}</h3>
        {download ? (
          <a className="pt-doc-guide-chip" href={download.href} download>
            <DownloadIcon />
            {download.label}
          </a>
        ) : null}
      </div>
      {sets.length > 1 ? (
        <div className="pt-doc-guide-sets" role="group" aria-label={strings.guideSamples}>
          {sets.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={index === cursor.set}
              onClick={() => onSelect({ set: index, page: 0 })}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="pt-doc-guide-hero is-scan"
        aria-label={`${strings.guideSampleOpen}: ${set.label}, ${page.caption}`}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <span className="pt-doc-guide-scan">
          {/* eslint-disable-next-line @next/next/no-img-element -- статичный образец из public/, оптимизатор не нужен */}
          <img src={page.src} alt="" loading="lazy" decoding="async" />
        </span>
        <span className="pt-doc-guide-zoom" aria-hidden="true"><ExpandIcon /></span>
      </button>
      <p className="pt-doc-guide-caption">
        {page.caption}
        {many ? <span> · {pageCounter(strings, pageIndex, set.pages.length)}</span> : null}
      </p>
      {many ? (
        // Длинный набор прокручивается вбок: тогда ряду нужен фокус с клавиатуры.
        <ol className="pt-doc-guide-pages" aria-label={set.label} tabIndex={set.pages.length > 5 ? 0 : undefined}>
          {set.pages.map((item, index) => (
            <li key={item.src}>
              <button
                type="button"
                aria-current={index === pageIndex ? "true" : undefined}
                aria-label={`${item.caption}, ${pageCounter(strings, index, set.pages.length)}`}
                onClick={() => onSelect({ set: cursor.set, page: index })}
              >
                <span className="pt-doc-guide-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element -- миниатюра того же статичного файла */}
                  <img src={item.thumb} alt="" loading="lazy" decoding="async" />
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** Крупный вид в окне образца: та же страница, листание по набору. */
export function SampleLightboxContent({
  guide,
  strings,
  cursor,
  onSelect,
}: {
  guide: DocumentGuideView;
  strings: Strings;
  cursor: SampleCursor;
  onSelect: (cursor: SampleCursor) => void;
}) {
  const sets = guide.sampleSets;
  if (sets.length === 0) {
    return (
      <>
        <SampleFigure guide={guide} enlarged />
        <SampleLegend guide={guide} />
      </>
    );
  }
  const set = sets[Math.min(cursor.set, sets.length - 1)];
  const pageIndex = Math.min(cursor.page, set.pages.length - 1);
  const page = set.pages[pageIndex];
  const many = set.pages.length > 1;
  return (
    <>
      <span className="pt-doc-guide-scan is-large">
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный образец из public/ */}
        <img src={page.src} alt={`${set.label}: ${page.caption}`} loading="lazy" decoding="async" />
      </span>
      <div className="pt-doc-guide-pager">
        {many ? (
          <button
            type="button"
            className="pt-doc-guide-pager-btn"
            aria-label={strings.guidePagePrev}
            aria-disabled={pageIndex === 0}
            onClick={() => {
              if (pageIndex > 0) onSelect({ set: cursor.set, page: pageIndex - 1 });
            }}
          >
            <Chevron direction="left" />
          </button>
        ) : null}
        <p aria-live="polite" aria-atomic="true">
          <strong>{page.caption}</strong>
          {many ? <span>{pageCounter(strings, pageIndex, set.pages.length)}</span> : null}
        </p>
        {many ? (
          <button
            type="button"
            className="pt-doc-guide-pager-btn"
            aria-label={strings.guidePageNext}
            aria-disabled={pageIndex === set.pages.length - 1}
            onClick={() => {
              if (pageIndex < set.pages.length - 1) onSelect({ set: cursor.set, page: pageIndex + 1 });
            }}
          >
            <Chevron direction="right" />
          </button>
        ) : null}
      </div>
    </>
  );
}

function SampleLegend({ guide }: { guide: DocumentGuideView }) {
  return (
    <p className="pt-doc-guide-legend">
      {guide.pins.map((pin) => (
        <span key={pin.n}>
          <i aria-hidden="true">{pin.n}</i>
          {pin.legend}
        </span>
      ))}
    </p>
  );
}

function SampleFigure({ guide, enlarged = false }: { guide: DocumentGuideView; enlarged?: boolean }) {
  return (
    <span className={enlarged ? "pt-doc-guide-figure is-large" : "pt-doc-guide-figure"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- статический SVG-образец из public/, оптимизатор не нужен */}
      <img src={guide.sampleSrc} alt="" width={640} height={400} loading="lazy" decoding="async" />
      {guide.pins.map((pin) => (
        <span key={pin.n} className="pt-doc-guide-pin" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} aria-hidden="true">
          {pin.n}
        </span>
      ))}
    </span>
  );
}

function pageCounter(strings: Strings, index: number, total: number): string {
  return strings.guidePageCounter.replace("{n}", String(index + 1)).replace("{m}", String(total));
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
