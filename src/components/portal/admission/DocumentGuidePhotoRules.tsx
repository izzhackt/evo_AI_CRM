import type { GuideCountry } from "@/lib/portal/document-guides";
import type { PortalStrings } from "@/lib/portal/i18n";

type Strings = PortalStrings<"admission">;
type Variant = "ok" | "glasses" | "ears" | "clothes";

/**
 * Памятка «Каким должно быть фото» (присланная руководителем памятка 20.11.2026, перерисована): правильно, очки,
 * закрытые уши, светлая одежда. Размер — по стране: Китай 33×48 и 8+1 (руководство куратора), Малайзия 35×45 и только
 * цифровой файл (памятка). Рисунок — силуэт, не фото человека; подписи переводятся.
 */
export function DocumentGuidePhotoRules({
  country,
  strings,
  titleId,
}: {
  country: GuideCountry | null;
  strings: Strings;
  titleId: string;
}) {
  const spec = country === "CN" ? strings.guidePhotoSpecCN : country === "MY" ? strings.guidePhotoSpecMY : strings.guidePhotoSpecAny;
  const cases: readonly { variant: Variant; title: string; hint: string }[] = [
    { variant: "ok", title: strings.guidePhotoOk, hint: strings.guidePhotoOkHint },
    { variant: "glasses", title: strings.guidePhotoGlasses, hint: strings.guidePhotoGlassesHint },
    { variant: "ears", title: strings.guidePhotoEars, hint: strings.guidePhotoEarsHint },
    { variant: "clothes", title: strings.guidePhotoClothes, hint: strings.guidePhotoClothesHint },
  ];
  return (
    <section className="pt-doc-guide-photo" aria-labelledby={`${titleId}-photo`}>
      <h3 id={`${titleId}-photo`}>{strings.guidePhotoRulesTitle}</h3>
      <p className="pt-doc-guide-photo-spec">{spec}</p>
      <ul>
        {cases.map((item) => (
          <li key={item.variant} data-ok={item.variant === "ok" ? "true" : "false"}>
            <span className="pt-doc-guide-photo-frame">
              <Silhouette variant={item.variant} />
              <span className="pt-doc-guide-photo-mark" aria-hidden="true">
                {item.variant === "ok" ? <CheckMark /> : <CrossMark />}
              </span>
            </span>
            <strong>
              {item.variant === "ok" ? null : <span className="pt-sr-only">{strings.guidePhotoWrong}: </span>}
              {item.title}
            </strong>
            <span>{item.hint}</span>
          </li>
        ))}
      </ul>
      <p className="pt-doc-guide-photo-note">
        {strings.guidePhotoNever}
        {country === "MY" ? ` ${strings.guidePhotoNoScan}` : ""}
      </p>
    </section>
  );
}

function Silhouette({ variant }: { variant: Variant }) {
  return (
    <svg viewBox="0 0 66 84" aria-hidden="true" focusable="false">
      {variant === "ears" ? <ellipse className="ink" cx="33" cy="33" rx="19" ry="22" /> : null}
      <ellipse className="skin" cx="16.5" cy="35" rx="3.2" ry="5" />
      <ellipse className="skin" cx="49.5" cy="35" rx="3.2" ry="5" />
      <ellipse className="skin" cx="33" cy="33" rx="15" ry="18" />
      {variant === "ears" ? <path className="ink" d="M14 34c0-14 8-23 19-23s19 9 19 23c-3-8-10-12-19-12s-16 4-19 12z" /> : null}
      <rect className="skin" x="28" y="48" width="10" height="9" />
      <path className={variant === "clothes" ? "light" : "ink"} d="M8 84c1-16 10-25 25-25s24 9 25 25z" />
      {variant === "glasses" ? (
        <g className="frame" fill="none" strokeWidth="2.2">
          <circle cx="26" cy="33" r="5" />
          <circle cx="40" cy="33" r="5" />
          <path d="M31 33h4" />
        </g>
      ) : null}
    </svg>
  );
}

function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
