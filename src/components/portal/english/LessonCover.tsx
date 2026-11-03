import { LessonIllustration } from "./LessonIllustration";
import { LESSON_COVERS } from "./lesson-cover-files";

/**
 * Обложка плитки урока: номер, фото темы и английская плашка; у урока без
 * фото — прежний линейный рисунок на тоне бумаги. Обложка декоративная:
 * название и номер урока читаются из тела плитки.
 */
export function LessonCover({ lessonKey, orderIndex }: Readonly<{ lessonKey: string; orderIndex: number }>) {
  const num = String(orderIndex).padStart(2, "0");
  const cover = LESSON_COVERS[lessonKey];
  if (!cover) {
    return (
      <span className="pt-lesson-cover" aria-hidden="true">
        <span className="pt-lesson-num">{num}</span>
        <LessonIllustration lessonKey={lessonKey} />
      </span>
    );
  }
  return (
    <span className="pt-lesson-cover pt-lesson-cover-photo" aria-hidden="true">
      <img
        className="pt-lesson-photo"
        src={cover.photo.src}
        width={cover.photo.width}
        height={cover.photo.height}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <span className="pt-lesson-num">{num}</span>
      <span className="pt-lesson-label">{cover.label}</span>
    </span>
  );
}
