/**
 * Настоящие образцы документов для справки «Образец и советы» (задание руководителя 20.11.2026).
 *
 * Это сканы документов бывших студентов и образцы из руководства куратора Китая. Личные данные закрыты сплошными
 * плашками, печати размыты; каждую страницу проверяли два независимых проверяющих. Решение класть их в кабинет —
 * Айвара, 20.11.2026 (docs/design/v3/product.md). Новые сканы добавляются только так же: сначала закраска и проверка,
 * потом файл в public/portal/document-samples (имя: строчные латинские буквы, цифры и дефисы, .jpg).
 *
 * Справку из банка, сертификаты IELTS и HSK, результаты CSCA и свидетельство о рождении нарисовали сами, с выдуманными
 * данными (студентка «Образцова Алина», нули вместо номеров), без логотипов, гербов, печатей и подписей и с водяным знаком
 * «ОБРАЗЕЦ» (ответ Айвара 23.11.2026: найти в интернете). Официальные образцы брать нельзя: условия IELTS, ETS, HSK и
 * csca.cn запрещают перепечатку, у банков своих образцов нет, а фото свидетельства в новостях — с настоящими данными.
 * Исходники и отрисовка — scripts/portal/document-specimens (HTML -> JPG одной командой).
 *
 * Если у документа есть наборы для страны дела, справка показывает их вместо нарисованной схемы.
 */
import type { GuideCountry } from "./document-guides.ts";

type Line = Readonly<{ ru: string; ky: string }>;

export type DocumentSampleSetSource = Readonly<{
  id: string;
  label: Line;
  /** Только для этой страны (бланк медсправки — китайский). Без страны — для всех. */
  country?: GuideCountry;
  pages: readonly Readonly<{ file: string; caption: Line }>[];
  /** Пустой бланк, который студент печатает сам. */
  download?: Readonly<{ file: string; label: Line }>;
}>;

const ORIGINAL: Line = { ru: "Оригинал", ky: "Түп нуска" };
const TRANSLATION: Line = { ru: "Перевод", ky: "Котормо" };
const NOTARY: Line = { ru: "Заверка нотариуса", ky: "Нотариустун күбөлөндүрүүсү" };
const NOTARY_EN: Line = { ru: "Заверка, англ.", ky: "Күбөлөндүрүү, англ." };
const page = (n: number): Line => ({ ru: `Страница ${n}`, ky: `${n}-бет` });
/** Нарисованный нами образец с вымышленными данными. */
const FICTIONAL: Line = { ru: "Пример, данные вымышлены", ky: "Үлгү, маалыматтар ойдон чыгарылган" };
/** Официального образца нет нигде (CSCA): вид примерный, настоящий отчёт может выглядеть иначе. */
const APPROXIMATE: Line = { ru: "Примерный вид, данные вымышлены", ky: "Болжолдуу көрүнүшү, маалыматтар ойдон чыгарылган" };

export const DOCUMENT_SAMPLE_SETS: Readonly<Partial<Record<string, readonly DocumentSampleSetSource[]>>> = {
  passport: [
    {
      id: "passport",
      label: { ru: "Паспорт", ky: "Паспорт" },
      pages: [{ file: "passport-1.jpg", caption: { ru: "Страница с данными", ky: "Маалымат бети" } }],
    },
  ],
  attestat: [
    {
      id: "attestat",
      label: { ru: "Аттестат", ky: "Аттестат" },
      pages: [
        { file: "attestat-1.jpg", caption: ORIGINAL },
        { file: "attestat-2.jpg", caption: { ru: "Оценки", ky: "Баалар" } },
        { file: "attestat-3.jpg", caption: { ru: "Оценки на кыргызском", ky: "Баалар кыргызча" } },
        { file: "attestat-4.jpg", caption: TRANSLATION },
        { file: "attestat-5.jpg", caption: { ru: "Перевод оценок", ky: "Баалардын котормосу" } },
        { file: "attestat-6.jpg", caption: NOTARY },
        { file: "attestat-7.jpg", caption: NOTARY_EN },
      ],
    },
    {
      id: "diploma",
      label: { ru: "Диплом колледжа", ky: "Колледждин дипломы" },
      pages: [
        { file: "diploma-1.jpg", caption: ORIGINAL },
        { file: "diploma-2.jpg", caption: { ru: "Оригинал на русском", ky: "Орусча түп нуска" } },
        { file: "diploma-3.jpg", caption: TRANSLATION },
        { file: "diploma-4.jpg", caption: NOTARY },
        { file: "diploma-5.jpg", caption: NOTARY_EN },
      ],
    },
    {
      id: "grades",
      label: { ru: "Табель", ky: "Табель" },
      pages: [
        { file: "grades-1.jpg", caption: { ru: "Табель, если ещё учитесь", ky: "Табель, азыр окусаңыз" } },
        { file: "grades-2.jpg", caption: TRANSLATION },
        { file: "grades-3.jpg", caption: NOTARY },
      ],
    },
  ],
  study_certificate: [
    {
      id: "study",
      label: { ru: "Справка с переводом", ky: "Котормосу менен маалымкат" },
      pages: [
        { file: "study-1.jpg", caption: ORIGINAL },
        { file: "study-2.jpg", caption: TRANSLATION },
        { file: "study-3.jpg", caption: NOTARY },
      ],
    },
  ],
  police_certificate: [
    {
      id: "police",
      label: { ru: "Справка с переводом", ky: "Котормосу менен маалымкат" },
      pages: [
        { file: "police-1.jpg", caption: ORIGINAL },
        { file: "police-2.jpg", caption: TRANSLATION },
        { file: "police-3.jpg", caption: NOTARY },
      ],
    },
  ],
  medical: [
    {
      id: "medical-blank",
      label: { ru: "Бланк", ky: "Бланк" },
      country: "CN",
      pages: [{ file: "medical-blank-1.jpg", caption: page(1) }, { file: "medical-blank-2.jpg", caption: page(2) }],
      download: { file: "medical-blank.pdf", label: { ru: "Скачать бланк", ky: "Бланкты жүктөп алуу" } },
    },
    {
      id: "medical-filled",
      label: { ru: "Пример заполнения", ky: "Толтуруунун үлгүсү" },
      country: "CN",
      pages: [{ file: "medical-filled-1.jpg", caption: page(1) }, { file: "medical-filled-2.jpg", caption: page(2) }],
    },
  ],
  motivation_letter: [
    {
      id: "motivation",
      label: { ru: "Пример оформления", ky: "Жазылышынын үлгүсү" },
      pages: [1, 2, 3].map((n) => ({ file: `motivation-${n}.jpg`, caption: page(n) })),
    },
  ],
  recommendation_letter: [
    {
      id: "recommendation",
      label: { ru: "Письмо на бланке школы", ky: "Мектептин бланкындагы кат" },
      pages: [{ file: "recommendation-1.jpg", caption: { ru: "Письмо", ky: "Кат" } }],
    },
  ],
  parental_consent: [
    {
      id: "consent",
      label: { ru: "Согласие у нотариуса", ky: "Нотариустагы макулдук" },
      pages: [{ file: "consent-1.jpg", caption: ORIGINAL }],
    },
  ],
  language_certificate: [
    {
      id: "ielts",
      label: { ru: "IELTS", ky: "IELTS" },
      pages: [{ file: "ielts-1.jpg", caption: FICTIONAL }],
    },
    {
      id: "hsk",
      label: { ru: "HSK", ky: "HSK" },
      pages: [{ file: "hsk-1.jpg", caption: FICTIONAL }],
    },
  ],
  csca_result: [
    {
      id: "csca",
      label: { ru: "Отчёт с баллами", ky: "Баллдар менен отчёт" },
      pages: [{ file: "csca-1.jpg", caption: APPROXIMATE }],
    },
  ],
  bank_statement: [
    {
      id: "bank",
      label: { ru: "Справка на английском", ky: "Англисче маалымкат" },
      pages: [{ file: "bank-statement-1.jpg", caption: FICTIONAL }],
    },
  ],
  birth_certificate: [
    {
      id: "birth",
      label: { ru: "Свидетельство", ky: "Күбөлүк" },
      pages: [{ file: "birth-certificate-1.jpg", caption: FICTIONAL }],
    },
  ],
};
