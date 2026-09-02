import type { ProfileDraft } from "@/components/v3/profile/types";

/**
 * Образец полей, которых в модели EVO пока нет.
 *
 * Живёт на странице, а не в компоненте, — как календарь и база знаний. Когда
 * схема догонит, меняется этот файл и источник, а не вёрстка вкладок.
 *
 * Проверено по базе: `evo_people` знает про человека ровно имя, телефон и
 * почту. У документа нет типа — есть сам документ и его файл, но какой он
 * (паспорт, аттестат, HSK), модель не хранит, поэтому «5 из 15» ей сегодня
 * посчитать нечем. Плана платежей нет: есть только сумма первого платежа в
 * основании передачи. Сущности сотрудника нет вовсе — есть три роли, а роль
 * это не человек.
 *
 * Всё, что отсюда, на экране подчёркнуто пунктиром.
 */

const DOCS = {
  Личные: [
    ["фото", "photo.jpg", "12.08"],
    ["паспорт", "passport.pdf", "12.08"],
    ["анкета", "anketa.pdf", "14.08"],
  ],
  "Об образовании": [
    ["аттестат / транскрипт", "transcript.pdf", "15.08"],
    ["справка с места учёбы", "study-cert.pdf", "15.08"],
    ["CV europass", null, null],
  ],
  Языковые: [
    ["HSK", null, null],
    ["TOEFL / IELTS", null, null],
    ["CENT S тест", null, null],
  ],
  Справки: [
    ["справка о несудимости", null, null],
    ["мед. справка", null, null],
    ["справка из банка", null, null],
  ],
  "Для поступления": [
    ["рекомендательные письма", null, null],
    ["мотивационное письмо", null, null],
    ["видео", null, null],
  ],
} as const;

export const PROFILE_SAMPLE: ProfileDraft = {
  responsible: "Мамашев Абдылда",
  provider: "Alex Li",

  person: [
    { label: "Возраст", value: "23" },
    { label: "Страна", value: "Китай" },
    { label: "Родители", value: "Chen Ming · +86 138 0000 0505" },
    { label: "Телефон источника", value: "+86 138 0000 0505" },
  ],

  study: [
    { label: "Интейк", value: "Fall 2026" },
    { label: "Факультет", value: "Computer Vision" },
    { label: "Уровень языка", value: "B1–B2" },
    { label: "Нынешнее образование", value: "Бакалавр окончен" },
    { label: "Учебное заведение", value: "Zhejiang University" },
    { label: "Основные критерии", value: "Стипендия, общежитие" },
  ],

  documents: Object.entries(DOCS).map(([title, items]) => ({
    title,
    items: items.map(([name, file, at]) => ({
      name,
      present: file !== null,
      file,
      at,
    })),
  })),

  otherFiles: [
    { name: "договор-2026-08-12.pdf", size: "412 КБ", at: "12.08" },
    { name: "переписка-выгрузка.pdf", size: "88 КБ", at: "20.08" },
  ],

  budget: "$1 300",
  currency: "USD",
  payments: [
    { name: "Первый платёж", amount: "$520", state: "paid", at: "оплачен 12.08" },
    { name: "Оплата 2", amount: "$390", state: "due", at: "до 15.09" },
    { name: "Оплата 3", amount: "$390", state: "due", at: "до 15.10" },
  ],
  paid: "$520",
  remaining: "$780",
  paidPercent: 40,
  contractSignedAt: "12.08.2026",
};

/**
 * У лида, до договора, платежей и половины анкеты ещё нет.
 *
 * Пустой образец нужен не для красоты: он показывает, как вкладки выглядят,
 * когда заполнять их нечем. Экран, который проверяли только на полном
 * человеке, разваливается на первом же новом.
 */
export const PROFILE_SAMPLE_EARLY: ProfileDraft = {
  ...PROFILE_SAMPLE,
  responsible: "Мамашев Абдылда",
  provider: null,
  person: PROFILE_SAMPLE.person.slice(0, 2),
  study: PROFILE_SAMPLE.study.slice(2, 4),
  documents: PROFILE_SAMPLE.documents.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, present: false, file: null, at: null })),
  })),
  otherFiles: [],
  budget: null,
  currency: null,
  payments: [],
  paid: null,
  remaining: null,
  paidPercent: null,
  contractSignedAt: null,
};
