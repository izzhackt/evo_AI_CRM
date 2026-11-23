import type { DocumentGuideView } from "@/lib/portal/document-guides";
import type { PortalStrings } from "@/lib/portal/i18n";

import { DocumentGuidePhotoRules } from "./DocumentGuidePhotoRules";
import { DocumentGuideSamples, type SampleCursor } from "./DocumentGuideSamples";

type Strings = PortalStrings<"admission">;

/**
 * Содержимое панели «Пример» — только пример (владелец 24.11.2026: «убери советы, просто пример»): образцы с вкладками и
 * страницами, бланк для скачивания, у «Фото» — картинки «правильно / неправильно» с размером. Описание, требования страны,
 * «Где взять», «Как сфотографировать», формат и частые ошибки панель больше не показывает; их тексты остаются в каталоге
 * (src/lib/portal/document-guides.ts), его читает и приложение на телефоне.
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
  return guide.photoRules ? (
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
  );
}
