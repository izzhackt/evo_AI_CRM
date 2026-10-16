import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { universityPhotoSrcSet, universityPhotoUrl } from "@/lib/university-photo-url";

/** Ширины уменьшенных копий: карточка ≈ 300–400 px (640w ≤ 80 КБ по приёмке S1), герой до ширины колонки. */
const CARD_WIDTHS = [480, 640] as const;
const HERO_WIDTHS = [800, 1200, 1600] as const;
const CARD_SIZES = "(min-width: 640px) 400px, 100vw";
const HERO_SIZES = "(min-width: 1100px) 1000px, 100vw";

export type PhotoFigureStrings = Pick<
  PortalStrings<"universities">,
  "photoMissing" | "photoFailed" | "photoBy" | "photoCrop" | "newTab"
>;

/**
 * Фото кампуса с сохранённой атрибуцией CC (PORT-3a): подпись, автор со
 * ссылкой на источник, лицензия со ссылкой и пометка о кадрировании — тот же
 * атрибуционный UX, что в staff-каталоге, но на портальных токенах и
 * словаре RU/KY.
 */
export function PhotoFigure({
  content,
  large = false,
  priority = false,
  strings,
}: {
  content: Pick<UniversityContent, "photoKey">;
  large?: boolean;
  /** Первые карточки экрана и герой: грузить сразу, не лениво. */
  priority?: boolean;
  strings: PhotoFigureStrings;
}) {
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  // PORT-9d: managed-URL после migrated=true в манифесте, иначе прежний hotlink.
  const src = universityPhotoUrl(content.photoKey) ?? photo?.path ?? null;
  const emptyClassName = `pt-photo-empty${large ? " pt-photo-empty-large" : ""}`;
  if (!photo || src === null) {
    return (
      <div className={emptyClassName}>
        {strings.photoMissing}
      </div>
    );
  }
  return (
    <UniversityPhotoFrame
      src={src}
      srcSet={universityPhotoSrcSet(content.photoKey, large ? HERO_WIDTHS : CARD_WIDTHS)}
      sizes={large ? HERO_SIZES : CARD_SIZES}
      priority={priority || large}
      alt={photo.caption}
      className="pt-photo"
      imageClassName={`pt-photo-img${large ? " pt-photo-img-large" : ""}`}
      emptyClassName={emptyClassName}
      failedText={strings.photoFailed}
    >
      <figcaption className="pt-photo-caption">
        <span className="pt-photo-caption-title">{photo.caption}</span>
        <span>
          <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">
            {formatPortalString(strings.photoBy, { author: photo.author })}
            <span className="pt-sr-only"> {strings.newTab}</span>
          </a>
          {" · "}
          <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">
            {photo.license}
            <span className="pt-sr-only"> {strings.newTab}</span>
          </a>
          {". "}
          {strings.photoCrop}
        </span>
      </figcaption>
    </UniversityPhotoFrame>
  );
}
