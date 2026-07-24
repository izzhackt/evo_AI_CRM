import type { Locale } from "@/lib/i18n";

export type SalesView = "board" | "list";

export type SalesCopy = {
  overviewHint: string;
  stageSeparation: string;
  viewLabel: string;
  kanban: string;
  list: string;
  quickAddHint: string;
  salesStages: string;
  filteredResult: string;
  noFilteredLeads: string;
  listCaption: string;
  actions: string;
};

const SALES_COPY: Record<Locale, SalesCopy> = {
  ru: {
    overviewHint:
      "Этапы продаж, задачи и последние касания по текущей локальной модели чтения EVO.",
    stageSeparation:
      "Ниже показаны этапы продаж. Операционные этапы студента ведутся отдельно в Student 360.",
    viewLabel: "Вид воронки продаж",
    kanban: "Канбан",
    list: "Список",
    quickAddHint:
      "Новый лид сохраняется в локальной базе EVO. Это не подтверждает создание записи в amoCRM.",
    salesStages: "Этапы продаж",
    filteredResult: "По текущим фильтрам",
    noFilteredLeads: "По текущим фильтрам лидов нет",
    listCaption: "Лиды по этапам продаж",
    actions: "Действия",
  },
  ky: {
    overviewHint:
      "EVOнун учурдагы жергиликтүү окуу моделиндеги сатуу этаптары, тапшырмалар жана акыркы байланыштар.",
    stageSeparation:
      "Төмөндө сатуу этаптары көрсөтүлөт. Студенттин операциялык этаптары Student 360 ичинде өзүнчө жүргүзүлөт.",
    viewLabel: "Сатуу воронкасынын көрүнүшү",
    kanban: "Канбан",
    list: "Тизме",
    quickAddHint:
      "Жаңы лид EVOнун жергиликтүү базасына сакталат. Бул amoCRM ичинде жазуу түзүлгөнүн ырастабайт.",
    salesStages: "Сатуу этаптары",
    filteredResult: "Учурдагы чыпкалар боюнча",
    noFilteredLeads: "Учурдагы чыпкалар боюнча лиддер жок",
    listCaption: "Сатуу этаптары боюнча лиддер",
    actions: "Аракеттер",
  },
  en: {
    overviewHint:
      "Sales stages, tasks, and latest touches from EVO's current local read model.",
    stageSeparation:
      "The stages below are sales stages. Student operational stages are managed separately in Student 360.",
    viewLabel: "Sales pipeline view",
    kanban: "Kanban",
    list: "List",
    quickAddHint:
      "A new lead is saved to EVO's local database. This does not confirm that a record was created in amoCRM.",
    salesStages: "Sales stages",
    filteredResult: "Current filters",
    noFilteredLeads: "No leads match the current filters",
    listCaption: "Leads by sales stage",
    actions: "Actions",
  },
};

export function getSalesCopy(locale: Locale) {
  return SALES_COPY[locale];
}
