import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";
import type { PortalStrings } from "@/lib/portal/i18n";
import { photoCreditRequired } from "@/lib/portal/university-index";
import { universityPhotoSrcSet, universityPhotoUrl } from "@/lib/university-photo-url";

/** Ширины уменьшенных копий фото-героя вуза: до ширины колонки. */
const HERO_WIDTHS = [800, 1200, 1600] as const;
const HERO_SIZES = "(min-width: 1100px) 1000px, 100vw";

export type PhotoFigureStrings = Pick<PortalStrings<"universities">, "photoMissing" | "photoFailed" | "photoCredit" | "newTab">;

/**
 * Фото-герой страницы вуза. Строка лицензии больше не печатается под каждым
 * фото (план 4.4, приёмка 7.6.5): автор и лицензия подписываются тихой
 * строкой «Фото:» только там, где этого требует лицензия (CC BY, CC BY-SA,
 * FAL). Сведения о фото остаются в библиотеке и манифесте.
 */
export function PhotoFigure({
  content,
  strings,
}: {
  content: Pick<UniversityContent, "photoKey">;
  strings: PhotoFigureStrings;
}) {
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  // PORT-9d: managed-URL после migrated=true в манифесте, иначе прежний hotlink.
  const src = universityPhotoUrl(content.photoKey) ?? photo?.path ?? null;
  const emptyClassName = "pt-photo-empty pt-photo-empty-large";
  if (!photo || src === null) {
    return <div className={emptyClassName}>{strings.photoMissing}</div>;
  }
  const [before, after] = strings.photoCredit.split("{author}");
  const [middle, end] = (after ?? "").split("{license}");
  return (
    <UniversityPhotoFrame
      src={src}
      srcSet={universityPhotoSrcSet(content.photoKey, HERO_WIDTHS)}
      sizes={HERO_SIZES}
      priority
      alt={photo.caption}
      className="pt-photo"
      imageClassName="pt-photo-img pt-photo-img-large"
      emptyClassName={emptyClassName}
      failedText={strings.photoFailed}
    >
      {photoCreditRequired(photo) ? (
        <figcaption className="pt-photo-caption pt-photo-credit">
          {before}
          <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">
            {photo.author}
            <span className="pt-sr-only"> {strings.newTab}</span>
          </a>
          {middle}
          <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">
            {photo.license}
            <span className="pt-sr-only"> {strings.newTab}</span>
          </a>
          {end}
        </figcaption>
      ) : null}
    </UniversityPhotoFrame>
  );
}
