import Link from "next/link";

import type { DocumentGuideView } from "@/lib/portal/document-guides";
import type { PortalStrings } from "@/lib/portal/i18n";

import { PhotoTipIcon } from "./DocumentGuideIcons";
import { DocumentGuidePhotoRules } from "./DocumentGuidePhotoRules";
import { DocumentGuideSamples, type SampleCursor } from "./DocumentGuideSamples";

const PROGRAMS_HREF = "/portal?view=programs#list";

type Strings = PortalStrings<"admission">;

/**
 * Содержимое панели «Образец и советы» — от «что это» к «как не ошибиться»: первая фраза, образцы (или памятка по
 * фото), требования страны, шаги «Где взять», «Как сфотографировать», формат и частые ошибки.
 */
export function DocumentGuideBody({
  guide,
  strings,
  titleId,
  cursor,
  onSelectSample,
  onOpenSample,
}: {
  guide: DocumentGuideView;
  strings: Strings;
  titleId: string;
  cursor: SampleCursor;
  onSelectSample: (cursor: SampleCursor) => void;
  onOpenSample: (button: HTMLButtonElement) => void;
}) {
  const tips = [
    { kind: "whole", text: strings.guidePhotoWhole },
    { kind: "light", text: strings.guidePhotoLight },
    { kind: "sharp", text: strings.guidePhotoSharp },
    { kind: "pdf", text: strings.guidePhotoPdf },
  ] as const;
  const notes = guide.countryNotes;

  return (
    <>
      <p className="pt-doc-guide-lead">{guide.description}</p>
      {guide.photoRules ? (
        <DocumentGuidePhotoRules country={guide.photoRules.country} strings={strings} titleId={titleId} />
      ) : (
        <DocumentGuideSamples
          guide={guide}
          strings={strings}
          titleId={titleId}
          cursor={cursor}
          onSelect={onSelectSample}
          onOpen={onOpenSample}
        />
      )}
      {notes ? (
        <section className="pt-doc-guide-country" aria-labelledby={`${titleId}-country`}>
          <h3 id={`${titleId}-country`}>{notes.country === "MY" ? strings.guideCountryMY : strings.guideCountryCN}</h3>
          {notes.items.length ? (
            <ul>
              {notes.items.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
          {notes.sections.map((section) => (
            <div key={section.title} className="pt-doc-guide-country-part">
              <h4>{section.title}</h4>
              <ul>
                {section.items.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ))}
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
      <div className="pt-doc-guide-fine">
        <p className="pt-doc-guide-req">{guide.requirements}</p>
        <p className="pt-doc-guide-mistakes">{guide.mistakes}</p>
        <p className="pt-doc-guide-university">
          {strings.guideUniversityNote}{" "}
          <Link className="pt-link" href={PROGRAMS_HREF}>{strings.guideUniversityLink}</Link>
        </p>
      </div>
    </>
  );
}
