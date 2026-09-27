import { Icon } from "@/components/icons";
import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";
import { universityPhotoUrl } from "@/lib/university-photo-url";
import { photoLicenseRu } from "@/lib/v3/university-view";

/**
 * Реальное фото кампуса (Э6, 27.09.2026).
 *
 * - `thumb` — 48 px в строке таблицы «Университетов». Рядом стоит название,
 *   поэтому фото — украшение (`alt=""`); авторство — на странице
 *   университета, куда ведёт строка (ссылка на страницу с атрибуцией —
 *   допустимый для CC способ указать автора).
 * - `side` — сбоку на странице университета, меньше прежнего: под ним одна
 *   короткая строка авторства по-русски — автор со ссылкой на источник,
 *   лицензия со ссылкой, «кадрировано» (фото обрезано под рамку).
 */
export function UniversityPhoto({ content, variant }: { content: Pick<UniversityContent, "photoKey">; variant: "thumb" | "side" }) {
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  // PORT-9d: managed-URL после migrated=true в манифесте, иначе прежний hotlink.
  const src = universityPhotoUrl(content.photoKey) ?? photo?.path ?? null;
  if (variant === "thumb") {
    const empty = "grid size-12 shrink-0 place-items-center rounded-nav border border-border bg-surface-2 text-fg-3";
    if (!photo || src === null) {
      return <span aria-hidden="true" className={empty}><Icon name="building" size={20} /></span>;
    }
    return (
      <UniversityPhotoFrame src={src} alt="" className="size-12 shrink-0 overflow-hidden rounded-nav border border-border bg-surface-2" imageClassName="size-full object-cover" emptyClassName={empty} failedText="">
        {null}
      </UniversityPhotoFrame>
    );
  }
  const emptyClassName = "flex aspect-[4/3] items-center justify-center rounded-card border border-border bg-surface-2 px-6 text-center t-body-compact text-fg-3";
  if (!photo || src === null) return <div className={emptyClassName}>Проверенное фото кампуса пока не добавлено</div>;
  return (
    <UniversityPhotoFrame src={src} alt={photo.caption} className="min-w-0" imageClassName="aspect-[4/3] w-full rounded-card border border-border bg-surface-2 object-cover" emptyClassName={emptyClassName} failedText="Не удалось загрузить фото кампуса">
      <figcaption className="t-meta mt-1.5 text-fg-3 [overflow-wrap:anywhere]" data-photo-credit="">
        Фото: <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">{photo.author}<span className="sr-only"> (в новой вкладке)</span></a>
        {" · "}
        <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">{photoLicenseRu(photo.license)}<span className="sr-only"> (в новой вкладке)</span></a>
        {" · кадрировано"}
      </figcaption>
    </UniversityPhotoFrame>
  );
}
