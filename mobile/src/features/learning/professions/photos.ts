// Фото профессий: те же 24 WebP 720 x 405, что у веба (`src/content/professions/photos`, сопоставление с ключом карточки -
// `src/components/portal/professions/profession-photo-files.ts`), копий в приложении нет: Metro читает их из `src` веба, как обложки
// «Английского» (`english/covers.ts`). Они едут в сборке и в обновлении как ресурсы (около 950 КБ все вместе), по сети не грузятся:
// у веба это статический импорт Next с хешем в имени (`/_next/static/media/...`), стабильного публичного адреса у них нет.
// Снимки сгенерированы (как обложки уроков), это не места и не кампусы; нет ключа - нет фото (`ProfessionPhoto` ничего не рисует).
// Ключ - `cardKey` карточки каталога (миграция 359); сверка набора с вебом - `__tests__/professions-photos.test.ts`.
/** Ресурс сборки (`require` даёт идентификатор ресурса): `expo-image` принимает его как `source`. */
export type ProfessionPhotoSource = number;

export const PROFESSION_PHOTOS: Readonly<Record<string, ProfessionPhotoSource>> = {
  "accountant": require("../../../../../src/content/professions/photos/accountant.webp"),
  "aerospace-engineer": require("../../../../../src/content/professions/photos/aerospace-engineer.webp"),
  "architect": require("../../../../../src/content/professions/photos/architect.webp"),
  "chemical-engineer": require("../../../../../src/content/professions/photos/chemical-engineer.webp"),
  "cybersecurity-specialist": require("../../../../../src/content/professions/photos/cybersecurity-specialist.webp"),
  "data-scientist": require("../../../../../src/content/professions/photos/data-scientist.webp"),
  "financial-analyst": require("../../../../../src/content/professions/photos/financial-analyst.webp"),
  "graphic-designer": require("../../../../../src/content/professions/photos/graphic-designer.webp"),
  "hotel-manager": require("../../../../../src/content/professions/photos/hotel-manager.webp"),
  "interface-designer": require("../../../../../src/content/professions/photos/interface-designer.webp"),
  "international-relations-analyst": require("../../../../../src/content/professions/photos/international-relations-analyst.webp"),
  "language-teacher": require("../../../../../src/content/professions/photos/language-teacher.webp"),
  "lawyer": require("../../../../../src/content/professions/photos/lawyer.webp"),
  "logistics-specialist": require("../../../../../src/content/professions/photos/logistics-specialist.webp"),
  "maritime-officer": require("../../../../../src/content/professions/photos/maritime-officer.webp"),
  "marketing-manager": require("../../../../../src/content/professions/photos/marketing-manager.webp"),
  "mechanical-engineer": require("../../../../../src/content/professions/photos/mechanical-engineer.webp"),
  "nurse": require("../../../../../src/content/professions/photos/nurse.webp"),
  "paramedic": require("../../../../../src/content/professions/photos/paramedic.webp"),
  "physician": require("../../../../../src/content/professions/photos/physician.webp"),
  "project-manager": require("../../../../../src/content/professions/photos/project-manager.webp"),
  "software-developer": require("../../../../../src/content/professions/photos/software-developer.webp"),
  "tour-guide": require("../../../../../src/content/professions/photos/tour-guide.webp"),
  "translator": require("../../../../../src/content/professions/photos/translator.webp"),
};
