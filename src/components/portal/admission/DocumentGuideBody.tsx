import Link from "next/link";

import type { DocumentGuideView } from "@/lib/portal/document-guides";
import type { PortalStrings } from "@/lib/portal/i18n";

import { ExpandIcon, PhotoTipIcon } from "./DocumentGuideIcons";

const PROGRAMS_HREF = "/portal?view=programs#list";

type Strings = PortalStrings<"admission">;

/**
 * Содержимое панели «Образец и советы»: что это, образец с метками, требования страны, где взять,
 * как сфотографировать, частые ошибки. Порядок — от «что это» к «как не ошибиться».
 */
export function DocumentGuideBody({
  guide,
  strings,
  titleId,
  onOpenSample,
}: {
  guide: DocumentGuideView;
  strings: Strings;
  titleId: string;
  onOpenSample: (button: HTMLButtonElement) => void;
}) {
  const tips = [
    { kind: "whole", text: strings.guidePhotoWhole },
    { kind: "light", text: strings.guidePhotoLight },
    { kind: "sharp", text: strings.guidePhotoSharp },
    { kind: "pdf", text: strings.guidePhotoPdf },
  ] as const;

  return (
    <>
      <p className="pt-doc-guide-lead">{guide.description}</p>
      <section className="pt-doc-guide-sample" aria-labelledby={`${titleId}-sample`}>
        <div className="pt-doc-guide-sample-head">
          <h3 id={`${titleId}-sample`}>{strings.guideSample}</h3>
          <button type="button" className="pt-doc-guide-chip" onClick={(event) => onOpenSample(event.currentTarget)}>
            {strings.guideSampleOpen}
            <ExpandIcon />
          </button>
        </div>
        <button
          type="button"
          className="pt-doc-guide-hero"
          aria-label={strings.guideSampleOpen}
          onClick={(event) => onOpenSample(event.currentTarget)}
        >
          <SampleFigure guide={guide} />
        </button>
        <SampleLegend guide={guide} />
      </section>
      {guide.countryNotes ? (
        <section className="pt-doc-guide-country" aria-labelledby={`${titleId}-country`}>
          <h3 id={`${titleId}-country`}>{strings.guideCountryCN}</h3>
          <ul>
            {guide.countryNotes.items.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
      ) : null}
      <section className="pt-doc-guide-where" aria-labelledby={`${titleId}-where`}>
        <h3 id={`${titleId}-where`}>{strings.guideWhere}</h3>
        <ol>
          {guide.where.map((line) => <li key={line}>{line}</li>)}
        </ol>
      </section>
      {guide.photoTips ? (
        <section className="pt-doc-guide-tips" aria-labelledby={`${titleId}-tips`}>
          <h3 id={`${titleId}-tips`}>{strings.guidePhotoTitle}</h3>
          <ul>
            {tips.map((tip) => (
              <li key={tip.kind}>
                <PhotoTipIcon kind={tip.kind} />
                <span>{tip.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="pt-doc-guide-req">{guide.requirements}</p>
      <p className="pt-doc-guide-mistakes">{guide.mistakes}</p>
      <p className="pt-doc-guide-university">
        {strings.guideUniversityNote}{" "}
        <Link className="pt-link" href={PROGRAMS_HREF}>{strings.guideUniversityLink}</Link>
      </p>
    </>
  );
}

export function SampleLegend({ guide }: { guide: DocumentGuideView }) {
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

export function SampleFigure({ guide, enlarged = false }: { guide: DocumentGuideView; enlarged?: boolean }) {
  return (
    <span className={enlarged ? "pt-doc-guide-figure is-large" : "pt-doc-guide-figure"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- статический SVG-образец из public/, оптимизатор не нужен */}
      <img src={guide.sampleSrc} alt="" width={640} height={400} decoding="async" />
      {guide.pins.map((pin) => (
        <span
          key={pin.n}
          className="pt-doc-guide-pin"
          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
          aria-hidden="true"
        >
          {pin.n}
        </span>
      ))}
    </span>
  );
}
