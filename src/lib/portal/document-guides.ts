import type { Locale } from "../i18n-data.ts";

/**
 * Справка «что это за документ» для кабинета студента.
 *
 * TODO(staff-edit): перенести каталог в таблицу `platform.document_type_guides`,
 * ключ — тот же `typeKey`, что у классификации файла (миграция 348:
 * passport, attestat, language_certificate, application_form, …).
 * Сейчас таблица была бы пустой формой: строки, которые видит студент, — это
 * свободные пункты дела (`document_slots.display_label`, миграция 338),
 * у них `requirement_id` и `requirement_key` обычно пустые. Колонка на
 * `document_requirements` эти пункты не покроет. Редактора для сотрудников
 * ещё нет, а чтение студента идёт через отдельные SECURITY DEFINER-функции,
 * не через прямой SELECT. Каталог ниже собран так, чтобы экран не менять,
 * когда появится таблица и RLS: тот же ключ, те же поля, RU и KY.
 *
 * Тексты — общие подсказки, не правила конкретного вуза. KY ждёт вычитки
 * носителем языка.
 */

export const DOCUMENT_GUIDE_TYPES = [
  "passport",
  "photo",
  "attestat",
  "language_certificate",
  "application_form",
  "payment_receipt",
  "contract",
  "study_certificate",
  "police_certificate",
  "medical",
  "bank_statement",
  "motivation_letter",
  "recommendation_letter",
  "birth_certificate",
] as const;

export type DocumentGuideType = (typeof DOCUMENT_GUIDE_TYPES)[number];

type GuideCopy = Readonly<{
  description: string;
  where: readonly [string, string, string];
  requirements: string;
  mistakes: string;
}>;

type GuidePin = Readonly<{
  n: 1 | 2 | 3;
  /** Проценты от левого верхнего угла образца. */
  x: number;
  y: number;
  legend: Readonly<{ ru: string; ky: string }>;
}>;

type DocumentGuide = Readonly<{
  typeKey: DocumentGuideType;
  /** Точные подписи после normalizeDocumentLabel, RU и KY. */
  labels: readonly string[];
  /**
   * Стабильные ключи: requirement_key шаблона, вид классификации (348)
   * и виды файлов дела (`contract`, `receipt`, `pending_receipt`).
   */
  keys: readonly string[];
  sampleSrc: string;
  pins: readonly GuidePin[];
  ru: GuideCopy;
  ky: GuideCopy;
}>;

const SAMPLE = "/portal/document-samples";

const GUIDES: readonly DocumentGuide[] = [
  {
    typeKey: "passport",
    labels: [
      "загранпаспорт",
      "паспорт",
      "passport",
      "чет өлкөлүк паспорт",
      "паспорт (чет өлкөлүк)",
    ],
    keys: ["passport", "evo.passport.v1"],
    sampleSrc: `${SAMPLE}/passport.svg`,
    pins: [
      { n: 1, x: 18, y: 48, legend: { ru: "Разворот с фото", ky: "Сүрөтү бар бет" } },
      { n: 2, x: 86, y: 78, legend: { ru: "Срок действия", ky: "Мөөнөтү" } },
      { n: 3, x: 70, y: 90, legend: { ru: "Без бликов", ky: "Жарык таксыз" } },
    ],
    ru: {
      description: "Разворот с фото и данными: фамилия, имя, номер, даты выдачи и окончания срока. По нему сверяют личность.",
      where: [
        "Оформите загранпаспорт в ЦОН или паспортном столе",
        "Сфотографируйте разворот с фото, не обложку",
        "Какой запас срока нужен, скажет куратор — это не правило вуза",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · цветной разворот, без бликов",
      mistakes: "Не загружайте только обложку и не закрывайте углы пальцем или бликом.",
    },
    ky: {
      description: "Сүрөтү жана маалыматы бар бет: фамилия, ат, номер, берилген жана бүткөн күнү. Ушул бет менен адамды текшеришет.",
      where: [
        "Чет өлкөлүк паспортту ЦОНдон же паспорт столунан алыңыз",
        "Мукабасын эмес, сүрөтү бар бетти сүрөткө тартыңыз",
        "Канча мөөнөт керек экенин куратор айтат — бул университеттин эрежеси эмес",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · түстүү бет, жарык таксыз",
      mistakes: "Мукабасын гана жүктөбөңүз жана бурчтарын манжа же жарык так менен жаппаңыз.",
    },
  },
  {
    typeKey: "photo",
    labels: ["фото", "фотография", "photo", "сүрөт", "цветное фото"],
    keys: ["photo", "evo.photo.v1"],
    sampleSrc: `${SAMPLE}/photo.svg`,
    pins: [
      { n: 1, x: 50, y: 42, legend: { ru: "Лицо по центру", ky: "Жүз ортодо" } },
      { n: 2, x: 22, y: 22, legend: { ru: "Светлый фон", ky: "Ачык фон" } },
      { n: 3, x: 78, y: 70, legend: { ru: "Без фильтров", ky: "Чыпкасыз" } },
    ],
    ru: {
      description: "Цветное фото как на документы: лицо анфас, светлый фон. Размер для конкретного вуза скажет куратор.",
      where: [
        "Сфотографируйтесь на светлом фоне или в фотосалоне",
        "Лицо по центру, без головного убора и тёмных очков",
        "Нужный размер и фон назовёт куратор",
      ],
      requirements: "JPG или PNG · до 25 МБ · цветное, без фильтров",
      mistakes: "Не обрезайте лицо и не накладывайте фильтры.",
    },
    ky: {
      description: "Документке тарткандай түстүү сүрөт: жүз түз, фон ачык. Так өлчөмдү куратор айтат.",
      where: [
        "Ачык фондо же фотосалондо тартылыңыз",
        "Жүз ортодо, баш кийимсиз жана кара көз айнексиз",
        "Керектүү өлчөм менен фонду куратор айтат",
      ],
      requirements: "JPG же PNG · 25 МБга чейин · түстүү, чыпкасыз",
      mistakes: "Жүздү кесип салбаңыз жана чыпка колдонбоңуз.",
    },
  },
  {
    typeKey: "attestat",
    labels: [
      "аттестат или транскрипт",
      "аттестат / диплом",
      "аттестат",
      "диплом",
      "транскрипт",
      "аттестат же транскрипт",
    ],
    keys: ["attestat", "transcript"],
    sampleSrc: `${SAMPLE}/attestat.svg`,
    pins: [
      { n: 1, x: 32, y: 28, legend: { ru: "Имя как в паспорте", ky: "Паспорттогудай ат" } },
      { n: 2, x: 62, y: 58, legend: { ru: "Оценки", ky: "Баалар" } },
      { n: 3, x: 80, y: 82, legend: { ru: "Печать", ky: "Мөөр" } },
    ],
    ru: {
      description: "Документ об образовании: аттестат, диплом или транскрипт с оценками. Вуз смотрит предметы и оценки.",
      where: [
        "Возьмите оригинал в школе, колледже или вузе",
        "Отсканируйте все страницы, где есть оценки",
        "Если учёба ещё идёт — текущие оценки, как скажет куратор",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · все страницы с оценками",
      mistakes: "Не обрезайте печати и не присылайте только обложку.",
    },
    ky: {
      description: "Билим тууралуу документ: аттестат, диплом же баалары бар транскрипт. Университет сабактарды жана бааларды карат.",
      where: [
        "Түп нускасын мектептен, колледжден же жогорку окуу жайдан алыңыз",
        "Баалары бар барактардын баарын сканерлеңиз",
        "Окуу уланып жатса — учурдагы баалар, куратор айткандай",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · баалары бар барактар",
      mistakes: "Мөөрлөрдү кесип салбаңыз жана мукабасын гана жибербеңиз.",
    },
  },
  {
    typeKey: "language_certificate",
    labels: [
      "сертификат по языку (ielts, toefl), если есть",
      "сертификат по языку (ielts, toefl)",
      "toefl",
      "ielts",
      "тил боюнча сертификат",
    ],
    keys: ["language_certificate"],
    sampleSrc: `${SAMPLE}/language-score.svg`,
    pins: [
      { n: 1, x: 42, y: 36, legend: { ru: "Имя как в паспорте", ky: "Паспорттогудай ат" } },
      { n: 2, x: 84, y: 36, legend: { ru: "Дата теста", ky: "Тесттин күнү" } },
      { n: 3, x: 88, y: 72, legend: { ru: "Общий балл", ky: "Жалпы балл" } },
    ],
    ru: {
      description: "Официальный отчёт языкового теста, например TOEFL iBT или IELTS. Обычно смотрят общий балл и иногда баллы по частям.",
      where: [
        "Запишитесь на тест у организатора: TOEFL — на ets.org, IELTS — в центре IELTS",
        "Результат обычно приходит в личный кабинет через несколько дней",
        "Скачайте PDF и при необходимости отправьте баллы в вуз",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · часто просят отчёт не старше 2 лет",
      mistakes: "Не отправляйте обрезанный скриншот. Подойдёт ли старый отчёт, скажет куратор.",
    },
    ky: {
      description: "Тил тестинин расмий отчёту, мисалы TOEFL iBT же IELTS. Көбүнчө жалпы баллды, кээде бөлүктөр боюнча баллды карашат.",
      where: [
        "Тестке уюштуруучудан жазылыңыз: TOEFL — ets.org, IELTS — IELTS борбору",
        "Жыйынтык көбүнчө бир нече күндө жеке кабинетке келет",
        "PDF жүктөп алыңыз жана керек болсо баллды университетке жөнөтүңүз",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · көбүнчө 2 жылдан эски эмес отчёт сурашат",
      mistakes: "Кесилген скриншотту жөнөтпөңүз. Эски отчёт жарайбы, куратор айтат.",
    },
  },
  {
    typeKey: "application_form",
    labels: [
      "анкета / заявление",
      "анкета",
      "заявление",
      "анкета / арыз",
      "арыз",
    ],
    keys: ["application_form"],
    sampleSrc: `${SAMPLE}/application-form.svg`,
    pins: [
      { n: 1, x: 38, y: 34, legend: { ru: "Имя как в паспорте", ky: "Паспорттогудай ат" } },
      { n: 2, x: 62, y: 58, legend: { ru: "Программа", ky: "Программа" } },
      { n: 3, x: 78, y: 84, legend: { ru: "Подпись", ky: "Кол" } },
    ],
    ru: {
      description: "Анкета или заявление, которое просит вуз или EVO: личные данные и выбранная программа.",
      where: [
        "Бланк даёт куратор или кабинет вуза",
        "Заполните имя так же, как в паспорте",
        "Подпишите, если на бланке есть место для подписи",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · все страницы бланка",
      mistakes: "Не оставляйте пустыми обязательные поля и не подписывайте чужим именем.",
    },
    ky: {
      description: "Университет же EVO сураган анкета же арыз: жеке маалымат жана тандаган программа.",
      where: [
        "Бланкты куратор же университеттин кабинети берет",
        "Атты паспорттогудай жазыңыз",
        "Кол коюучу жер болсо, кол коюңуз",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · бланктын бардык барактары",
      mistakes: "Милдеттүү талааларды бош калтырбаңыз жана башканын атынан кол койбоңуз.",
    },
  },
  {
    typeKey: "payment_receipt",
    labels: ["чек об оплате", "чек", "квитанция", "төлөм чеги", "квитанция об оплате"],
    keys: ["payment_receipt", "receipt", "pending_receipt"],
    sampleSrc: `${SAMPLE}/payment-receipt.svg`,
    pins: [
      { n: 1, x: 40, y: 32, legend: { ru: "Получатель", ky: "Алуучу" } },
      { n: 2, x: 78, y: 32, legend: { ru: "Дата", ky: "Күнү" } },
      { n: 3, x: 72, y: 70, legend: { ru: "Сумма", ky: "Сумма" } },
    ],
    ru: {
      description: "Чек или квитанция об оплате: видно, кому, когда и за что заплатили. Сумму сверяет куратор.",
      where: [
        "Сохраните чек из банка или приложения сразу после оплаты",
        "На чеке должны быть дата, получатель и сумма",
        "Если такой строки нет в списке, куратор скажет, куда его положить",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · чек целиком, без обрезки",
      mistakes: "Не закрывайте сумму и дату и не присылайте только экран «успешно».",
    },
    ky: {
      description: "Төлөм чеги же квитанция: кимге, качан жана эмне үчүн төлөнгөнү көрүнөт. Сумманы куратор текшерет.",
      where: [
        "Төлөгөндөн кийин банктын же тиркеменин чегин сактаңыз",
        "Чекте күнү, алуучу жана сумма көрүнүшү керек",
        "Мындай сап тизмеде жок болсо, кайда коюуну куратор айтат",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · чек бүтүн, кесилбеген",
      mistakes: "Сумма менен күндү жаппаңыз жана «ийгиликтүү» деген гана экранды жибербеңиз.",
    },
  },
  {
    typeKey: "contract",
    labels: ["договор", "келишим"],
    keys: ["contract"],
    sampleSrc: `${SAMPLE}/contract.svg`,
    pins: [
      { n: 1, x: 36, y: 30, legend: { ru: "Стороны", ky: "Тараптар" } },
      { n: 2, x: 78, y: 30, legend: { ru: "Номер", ky: "Номери" } },
      { n: 3, x: 70, y: 82, legend: { ru: "Подпись", ky: "Кол" } },
    ],
    ru: {
      description: "Договор с EVO. В разделе «Договор и чеки» файл только для просмотра: новую версию добавляет команда EVO.",
      where: [
        "Договор готовит команда EVO",
        "Прочитайте его перед подписанием",
        "Куда положить подписанный скан, если его просят, скажет куратор",
      ],
      requirements: "PDF · до 25 МБ · все страницы",
      mistakes: "Не подписывайте пустой бланк и не закрывайте номер договора.",
    },
    ky: {
      description: "EVO менен келишим. «Келишим жана чектер» бөлүмүндө файл көрүү үчүн: жаңы версиясын EVO командасы кошот.",
      where: [
        "Келишимди EVO командасы даярдайт",
        "Кол коюудан мурун окуп чыгыңыз",
        "Кол коюлган сканды кайда коюуну, керек болсо, куратор айтат",
      ],
      requirements: "PDF · 25 МБга чейин · бардык барактар",
      mistakes: "Бош бланкка кол койбоңуз жана келишимдин номерин жаппаңыз.",
    },
  },
  {
    typeKey: "study_certificate",
    labels: ["справка с места учебы", "окуу жайынан маалымкат"],
    keys: ["study_certificate"],
    sampleSrc: `${SAMPLE}/study-certificate.svg`,
    pins: [
      { n: 1, x: 40, y: 36, legend: { ru: "Учебное заведение", ky: "Окуу жайы" } },
      { n: 2, x: 78, y: 36, legend: { ru: "Дата", ky: "Күнү" } },
      { n: 3, x: 72, y: 80, legend: { ru: "Печать", ky: "Мөөр" } },
    ],
    ru: {
      description: "Справка из школы или вуза, где вы учитесь сейчас. Какой бланк подойдёт, скажет куратор.",
      where: [
        "Попросите справку в канцелярии учебного заведения",
        "На ней должны быть дата и печать",
        "Точный бланк назовёт куратор",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · с печатью и датой",
      mistakes: "Не отправляйте справку без печати и с нечитаемой датой.",
    },
    ky: {
      description: "Азыр окуп жаткан мектептен же жогорку окуу жайдан маалымкат. Кайсы бланк жарай турганын куратор айтат.",
      where: [
        "Окуу жайдын канцеляриясынан сураңыз",
        "Күнү жана мөөрү көрүнүшү керек",
        "Так бланкты куратор айтат",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · мөөрү жана күнү менен",
      mistakes: "Мөөрү жок жана күнү окулбаган баракты жибербеңиз.",
    },
  },
  {
    typeKey: "police_certificate",
    labels: ["справка о несудимости", "соттолбогондук тууралуу маалымкат"],
    keys: ["police_certificate"],
    sampleSrc: `${SAMPLE}/police-certificate.svg`,
    pins: [
      { n: 1, x: 40, y: 38, legend: { ru: "Имя", ky: "Аты-жөнү" } },
      { n: 2, x: 78, y: 38, legend: { ru: "Дата", ky: "Күнү" } },
      { n: 3, x: 74, y: 78, legend: { ru: "Печать", ky: "Мөөр" } },
    ],
    ru: {
      description: "Справка о несудимости. Насколько свежей она должна быть, скажет куратор — срок здесь не задан.",
      where: [
        "Получите справку в ЦОН или уполномоченной службе",
        "Попросите свежий экземпляр",
        "Срок годности уточните у куратора",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · страница целиком",
      mistakes: "Не отправляйте справку без печати и с обрезанными краями.",
    },
    ky: {
      description: "Соттолбогондугу тууралуу маалымкат. Канчалык жаңы болушу керек экенин куратор айтат — мөөнөт бул жерде бекитилген эмес.",
      where: [
        "Маалымкатты ЦОНдон же ыйгарым укуктуу кызматтан алыңыз",
        "Жаңы нускасын сураңыз",
        "Жарактуу мөөнөтүн куратор менен тактаңыз",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · барак бүтүн",
      mistakes: "Мөөрү жок жана четтери кесилген маалымкатты жибербеңиз.",
    },
  },
  {
    typeKey: "medical",
    labels: ["медицинская справка", "медициналык маалымкат"],
    keys: ["medical"],
    sampleSrc: `${SAMPLE}/medical.svg`,
    pins: [
      { n: 1, x: 38, y: 36, legend: { ru: "Имя", ky: "Аты-жөнү" } },
      { n: 2, x: 76, y: 36, legend: { ru: "Дата", ky: "Күнү" } },
      { n: 3, x: 72, y: 80, legend: { ru: "Печать", ky: "Мөөр" } },
    ],
    ru: {
      description: "Медицинская справка. Какой бланк и какие осмотры нужны, скажет куратор — это не общий медицинский стандарт.",
      where: [
        "Узнайте бланк у куратора",
        "Пройдите осмотр там, куда он направит",
        "На справке должны быть дата и печать",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · с печатью",
      mistakes: "Не отправляйте пустой бланк и страницу без печати.",
    },
    ky: {
      description: "Медициналык маалымкат. Кайсы бланк жана кайсы текшерүү керек экенин куратор айтат — бул жалпы медициналык стандарт эмес.",
      where: [
        "Бланкты куратордон сураңыз",
        "Текшерүүдөн ал айткан жайда өтүңүз",
        "Маалымкатта күнү жана мөөрү болушу керек",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · мөөрү менен",
      mistakes: "Бош бланкты жана мөөрү жок баракты жибербеңиз.",
    },
  },
  {
    typeKey: "bank_statement",
    labels: ["справка из банка", "банктан маалымкат", "выписка из банка"],
    keys: ["bank_statement"],
    sampleSrc: `${SAMPLE}/bank-statement.svg`,
    pins: [
      { n: 1, x: 36, y: 34, legend: { ru: "Имя владельца", ky: "Ээсинин аты" } },
      { n: 2, x: 78, y: 34, legend: { ru: "Дата", ky: "Күнү" } },
      { n: 3, x: 70, y: 68, legend: { ru: "Остаток", ky: "Калдык" } },
    ],
    ru: {
      description: "Справка или выписка банка об остатке на счёте. Нужную сумму называет куратор, здесь её нет.",
      where: [
        "Возьмите выписку в банке или в приложении банка",
        "Должны быть видны ваше имя, дата и остаток",
        "Сумму уточните у куратора",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · страница целиком",
      mistakes: "Не закрывайте имя и остаток и не присылайте чужой счёт.",
    },
    ky: {
      description: "Эсептеги калдык тууралуу банк маалымкаты же көчүрмө. Керектүү сумманы куратор айтат, бул жерде ал жок.",
      where: [
        "Көчүрмөнү банктан же банк тиркемесинен алыңыз",
        "Атыңыз, күнү жана калдык көрүнүшү керек",
        "Сумманы куратор менен тактаңыз",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · барак бүтүн",
      mistakes: "Атты жана калдыкты жаппаңыз жана башканын эсебин жибербеңиз.",
    },
  },
  {
    typeKey: "motivation_letter",
    labels: ["мотивационное письмо", "мотивациялык кат"],
    keys: ["motivation_letter"],
    sampleSrc: `${SAMPLE}/motivation-letter.svg`,
    pins: [
      { n: 1, x: 28, y: 28, legend: { ru: "Ваше имя", ky: "Атыңыз" } },
      { n: 2, x: 55, y: 48, legend: { ru: "Программа", ky: "Программа" } },
      { n: 3, x: 72, y: 84, legend: { ru: "Подпись", ky: "Кол" } },
    ],
    ru: {
      description: "Письмо, почему вы выбрали страну, вуз и программу. Структуру подскажет куратор.",
      where: [
        "Напишите письмо сами",
        "Укажите имя и программу",
        "Подпишите, если куратор попросил подпись",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · весь текст",
      mistakes: "Не отправляйте чужое письмо и пустой шаблон.",
    },
    ky: {
      description: "Өлкөнү, университетти жана программаны эмне үчүн тандаганыңыз тууралуу кат. Түзүлүшүн куратор айтат.",
      where: [
        "Катты өзүңүз жазыңыз",
        "Атыңызды жана программаны жазыңыз",
        "Куратор сураса, кол коюңуз",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · текст толугу менен",
      mistakes: "Башка адамдын катын жана бош шаблонду жибербеңиз.",
    },
  },
  {
    typeKey: "recommendation_letter",
    labels: ["рекомендательные письма", "рекомендациялык кат", "рекомендательное письмо"],
    keys: ["recommendation_letter"],
    sampleSrc: `${SAMPLE}/recommendation-letter.svg`,
    pins: [
      { n: 1, x: 34, y: 30, legend: { ru: "Кто пишет", ky: "Ким жазган" } },
      { n: 2, x: 70, y: 78, legend: { ru: "Подпись", ky: "Кол" } },
      { n: 3, x: 78, y: 88, legend: { ru: "Контакт", ky: "Байланыш" } },
    ],
    ru: {
      description: "Письмо от учителя или преподавателя: с подписью и контактом, чтобы письмо можно было проверить.",
      where: [
        "Попросите учителя или преподавателя",
        "В письме должны быть ваше имя и программа",
        "Нужны подпись и контакт автора",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · с подписью",
      mistakes: "Не отправляйте письмо без подписи и без контакта автора.",
    },
    ky: {
      description: "Мугалим же окутуучунун каты: кол жана байланыш менен, катты текшерүүгө болушу үчүн.",
      where: [
        "Мугалимден же окутуучудан сураңыз",
        "Катта атыңыз жана программа болушу керек",
        "Автордун колу жана байланышы керек",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · колу менен",
      mistakes: "Колсуз жана байланышсыз катты жибербеңиз.",
    },
  },
  {
    typeKey: "birth_certificate",
    labels: ["свидетельство о рождении", "туулгандыгы тууралуу күбөлүк"],
    keys: ["birth_certificate"],
    sampleSrc: `${SAMPLE}/birth-certificate.svg`,
    pins: [
      { n: 1, x: 40, y: 40, legend: { ru: "Имя", ky: "Аты-жөнү" } },
      { n: 2, x: 72, y: 52, legend: { ru: "Дата рождения", ky: "Туулган күнү" } },
      { n: 3, x: 78, y: 80, legend: { ru: "Печать", ky: "Мөөр" } },
    ],
    ru: {
      description: "Свидетельство о рождении. Нужно ли оно и нужен ли перевод, скажет куратор.",
      where: [
        "Возьмите свидетельство в ЗАГСе",
        "Отсканируйте страницу, где видны имя и дата",
        "Про перевод спросите куратора",
      ],
      requirements: "PDF, JPG или PNG · до 25 МБ · страница целиком",
      mistakes: "Не обрезайте углы и не закрывайте имя.",
    },
    ky: {
      description: "Туулгандыгы тууралуу күбөлүк. Керекпи жана котормо керекпи, куратор айтат.",
      where: [
        "Күбөлүктү ЗАГСтан алыңыз",
        "Аты-жөнү жана күнү көрүнгөн бетти сканерлеңиз",
        "Котормо керекпи, куратордон сураңыз",
      ],
      requirements: "PDF, JPG же PNG · 25 МБга чейин · барак бүтүн",
      mistakes: "Бурчтарын кесип салбаңыз жана атты жаппаңыз.",
    },
  },
];

/** Нижний регистр, «ё» → «е», лишние пробелы сняты. KY- и RU-подписи сравниваются одинаково. */
export function normalizeDocumentLabel(label: string): string {
  return label
    .trim()
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[«»"“”]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/[.,;:!?]+$/u, "");
}

const KEY_INDEX = new Map<string, DocumentGuide>();
const LABEL_INDEX = new Map<string, DocumentGuide>();
for (const guide of GUIDES) {
  for (const key of guide.keys) KEY_INDEX.set(key, guide);
  for (const label of guide.labels) LABEL_INDEX.set(normalizeDocumentLabel(label), guide);
}

/*
 * Подпись, которую куратор написал сам, узнаётся по слову — но только если это документ самого ученика, а не похожий:
 * паспорт родителя, перевод или апостиль аттестата, медицинская страховка, договор аренды, анкета на визу, диплом
 * олимпиады. Чужая справка хуже, чем никакой: с такими словами кнопки «!» нет. Точные подписи из списка (LABEL_INDEX)
 * эта проверка не трогает.
 */
const NOT_THIS_DOCUMENT = /родител|отц|отец|матер|мать|ата-эне|ата эне|parent|father|mother|перевод|котормо|translation|апостил|нотариал|apostille|страхов|insurance|аренд|олимпиад|виз[аыуе]|визов|visa/u;

const LABEL_RULES: readonly Readonly<{ typeKey: DocumentGuideType; test: (label: string) => boolean }>[] = [
  { typeKey: "language_certificate", test: (label) => /toefl|ielts|hsk|duolingo|\bpte\b|сертификат по языку|тил боюнча сертификат|языковой сертификат/u.test(label) },
  { typeKey: "motivation_letter", test: (label) => /мотивационн|мотивациялык/u.test(label) },
  { typeKey: "recommendation_letter", test: (label) => /рекомендательн|рекомендациялык/u.test(label) },
  { typeKey: "payment_receipt", test: (label) => /чек об оплате|квитанц|төлөм чеги|^чек$/u.test(label) },
  { typeKey: "application_form", test: (label) => /анкета|заявление|^арыз$|application form/u.test(label) },
  // Справка — о договоре с EVO: «Договор с вузом» или «договор аренды» — другие бумаги.
  { typeKey: "contract", test: (label) => /^(договор|келишим|contract)( с evo| evo)?$/u.test(label) },
  { typeKey: "police_certificate", test: (label) => /несудимост|соттолбогон/u.test(label) },
  { typeKey: "medical", test: (label) => /медицинск|медициналык/u.test(label) },
  // «Выписка» бывает и из аттестата, и оценок: банковская — только со словом «банк» или «счёт».
  { typeKey: "bank_statement", test: (label) => /справка из банка|банктан маалымкат|bank statement|выписка (из|с|по) (банк|сче|сч)|банковск(ая|ой) выписк/u.test(label) },
  { typeKey: "study_certificate", test: (label) => /справка с места учебы|окуу жайынан маалымкат/u.test(label) },
  { typeKey: "birth_certificate", test: (label) => /свидетельств[оа] о рождении|туулгандыгы тууралуу/u.test(label) },
  { typeKey: "attestat", test: (label) => /аттестат|диплом|транскрипт|transcript|diploma/u.test(label) },
  // «Фото паспорта», «фото с паспортом» — это скан паспорта, а не фото 3×4 («Фото на паспорт» — фото 3×4).
  { typeKey: "photo", test: (label) => /^(фото|фотография|photo|сүрөт|цветное фото)( |$)/u.test(label) && !/паспорта|с паспортом|и паспорт|of passport|passport (page|copy|scan)/u.test(label) },
  { typeKey: "passport", test: (label) => /загранпаспорт|паспорт|passport|чет өлкө/u.test(label) && !/фото/u.test(label) },
];

const GUIDE_BY_TYPE = new Map(GUIDES.map((guide) => [guide.typeKey, guide]));

export type DocumentGuidePinView = Readonly<{ n: 1 | 2 | 3; x: number; y: number; legend: string }>;

export type DocumentGuideView = Readonly<{
  typeKey: DocumentGuideType;
  description: string;
  where: readonly string[];
  requirements: string;
  mistakes: string;
  sampleSrc: string;
  pins: readonly DocumentGuidePinView[];
}>;

function viewOf(guide: DocumentGuide, locale: Locale): DocumentGuideView {
  const copy = locale === "ky" ? guide.ky : guide.ru;
  return {
    typeKey: guide.typeKey,
    description: copy.description,
    where: copy.where,
    requirements: copy.requirements,
    mistakes: copy.mistakes,
    sampleSrc: guide.sampleSrc,
    pins: guide.pins.map((pin) => ({
      n: pin.n,
      x: pin.x,
      y: pin.y,
      legend: locale === "ky" ? pin.legend.ky : pin.legend.ru,
    })),
  };
}

/**
 * Справка к пункту списка. Нет совпадения — null: кнопку «!» не рисуют.
 * Известный ключ важнее подписи. Неизвестный ключ не мешает узнать документ по имени.
 */
export function documentGuideView(
  input: Readonly<{ requirementKey: string | null; label: string }>,
  locale: Locale,
): DocumentGuideView | null {
  const byKey = input.requirementKey ? KEY_INDEX.get(input.requirementKey) : undefined;
  if (byKey) return viewOf(byKey, locale);
  const normalized = normalizeDocumentLabel(input.label);
  if (!normalized) return null;
  const byLabel = LABEL_INDEX.get(normalized);
  if (byLabel) return viewOf(byLabel, locale);
  if (NOT_THIS_DOCUMENT.test(normalized)) return null;
  const rule = LABEL_RULES.find((candidate) => candidate.test(normalized));
  if (!rule) return null;
  const guide = GUIDE_BY_TYPE.get(rule.typeKey);
  return guide ? viewOf(guide, locale) : null;
}

/** Все образцы каталога. Тесты сверяют, что файл есть и это вымышленный образец. */
export function documentGuideSamples(): readonly Readonly<{ typeKey: DocumentGuideType; sampleSrc: string }>[] {
  return GUIDES.map((guide) => ({ typeKey: guide.typeKey, sampleSrc: guide.sampleSrc }));
}
