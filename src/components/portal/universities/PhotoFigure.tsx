import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { universityPhotoUrl } from "@/lib/university-photo-url";

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
  strings,
}: {
  content: Pick<UniversityContent, "photoKey">;
  large?: boolean;
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
