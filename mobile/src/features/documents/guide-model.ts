// Чистые правила листа «Пример» (веб: DocumentGuideSamples.tsx): адреса образцов, курсор по наборам и страницам,
// бланк. Без React и нативных модулей: проверяется обычными тестами.
import type { DocumentGuideView } from "@web/lib/portal/document-guides";

import { DOCUMENT_SAMPLE_SIZES } from "@/features/documents/document-sample-sizes.generated";

export type GuideSet = DocumentGuideView["sampleSets"][number];
export type GuidePage = GuideSet["pages"][number];
export type GuideBlank = NonNullable<GuideSet["download"]>;
export type SampleCursor = Readonly<{ set: number; page: number }>;
export const FIRST_PAGE: SampleCursor = Object.freeze({ set: 0, page: 0 });

/** Ширина окна, с которой веб переходит от нижнего листа к боковой панели (`max-width: 767px`): уже - «телефон», размеры меньше. */
export const PHONE_WIDTH = 768;

/**
 * Образцы лежат в public/portal/document-samples веба и отдаются без входа: исключение прокси `isDocumentSampleFile`
 * (src/lib/platform-route-contract.ts). Шаблон тот же; приложение просит у портала только такие файлы. Совпадение с
 * веб-шаблоном держит тест guide-model.test.ts.
 */
const SAMPLE_FILE_PATH = /^\/portal\/document-samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:svg|png|jpg|webp|pdf)$/;
const PORTAL_ORIGIN = /^https?:\/\/[^/?#\s]+$/;

/** Адрес образца на портале. Путь не из каталога образцов или чужой адрес портала - `null`: картинки не будет, останется схема. */
export function sampleUrl(portalBaseUrl: string, path: string): string | null {
  return PORTAL_ORIGIN.test(portalBaseUrl) && SAMPLE_FILE_PATH.test(path) ? `${portalBaseUrl}${path}` : null;
}

/** Имя файла образца из пути каталога: «/portal/document-samples/medical-blank.pdf» -> «medical-blank.pdf». */
export function sampleFileName(path: string): string {
  return path.split("/").pop() ?? "sample";
}

/**
 * Пропорции страницы образца (ширина / высота) по размерам из generated-файла: страница встаёт в рамку и получает тень,
 * ещё не загрузившись. Файла нет в списке (веб добавил образец, приложение не пересобрано) - `null`, тогда страница
 * просто вписывается в рамку без тени.
 */
export function pageAspect(path: string): number | null {
  const size = Object.hasOwn(DOCUMENT_SAMPLE_SIZES, sampleFileName(path)) ? DOCUMENT_SAMPLE_SIZES[sampleFileName(path)] : undefined;
  return size && size[1] > 0 ? size[0] / size[1] : null;
}

function clampIndex(index: number, length: number): number {
  const whole = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(whole, 0), length - 1);
}

export type CurrentSample = Readonly<{ set: GuideSet; setIndex: number; page: GuidePage; pageIndex: number; many: boolean }>;

/**
 * Выбранный набор и страница. Курсор за границей (набор пропал после смены страны, страниц стало меньше) прижимается к
 * краю, как в вебе. Нет настоящих образцов - `null`: показывается нарисованная схема.
 */
export function currentSample(guide: Pick<DocumentGuideView, "sampleSets">, cursor: SampleCursor): CurrentSample | null {
  const sets = guide.sampleSets;
  if (sets.length === 0) return null;
  const setIndex = clampIndex(cursor.set, sets.length);
  const set = sets[setIndex];
  if (!set || set.pages.length === 0) return null;
  const pageIndex = clampIndex(cursor.page, set.pages.length);
  const page = set.pages[pageIndex];
  return page ? { set, setIndex, page, pageIndex, many: set.pages.length > 1 } : null;
}

/** Пустой бланк, который студент печатает сам; скачивается при любом выбранном наборе (в вебе так же). */
export function guideBlank(guide: Pick<DocumentGuideView, "sampleSets">): GuideBlank | null {
  return guide.sampleSets.find((set) => set.download)?.download ?? null;
}

/** «Пример» у одной страницы, «Примеры», когда есть из чего выбирать (веб: `single`). */
export function sampleHeadingKey(guide: Pick<DocumentGuideView, "sampleSets">, current: CurrentSample): "guideSample" | "guideSamples" {
  return guide.sampleSets.length === 1 && !current.many ? "guideSample" : "guideSamples";
}
