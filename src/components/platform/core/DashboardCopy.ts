import type { Locale } from "@/lib/i18n";

export type DashboardCopy = {
  overviewHint: string;
  attentionEyebrow: string;
  attentionTitle: string;
  attentionHint: string;
  allClearTitle: string;
  allClearHint: string;
  localDataLabel: string;
  metricsLabel: string;
  allApplications: string;
};

const DASHBOARD_COPY: Record<Locale, DashboardCopy> = {
  ru: {
    overviewHint:
      "Приоритеты и показатели рассчитаны из текущей локальной базы EVO; статусы внешних сервисов здесь не предполагаются.",
    attentionEyebrow: "Сегодня требует внимания",
    attentionTitle: "Требует внимания сейчас",
    attentionHint:
      "Просрочки, работа без следующего шага, документы и непрочитанные диалоги.",
    allClearTitle: "Всё под контролем",
    allClearHint:
      "На сегодня срочных задач, просрочек и непрочитанных нет.",
    localDataLabel: "Локальные данные EVO",
    metricsLabel: "Основные показатели",
    allApplications: "Все заявки",
  },
  ky: {
    overviewHint:
      "Артыкчылыктар жана көрсөткүчтөр EVOнун учурдагы жергиликтүү базасынан эсептелет; тышкы сервистердин абалы болжолдонбойт.",
    attentionEyebrow: "Бүгүн көңүл буруу керек",
    attentionTitle: "Азыр көңүл бурууну талап кылат",
    attentionHint:
      "Мөөнөтү өткөн иштер, кийинки кадамы жок иштер, документтер жана окулбаган диалогдор.",
    allClearTitle: "Баары көзөмөлдө",
    allClearHint:
      "Бүгүн шашылыш тапшырмалар, мөөнөтү өткөн иштер жана окулбаган билдирүүлөр жок.",
    localDataLabel: "EVOнун жергиликтүү маалыматтары",
    metricsLabel: "Негизги көрсөткүчтөр",
    allApplications: "Бардык арыздар",
  },
  en: {
    overviewHint:
      "Priorities and metrics are calculated from EVO's current local database; external-service status is not inferred here.",
    attentionEyebrow: "Needs attention today",
    attentionTitle: "Needs attention now",
    attentionHint:
      "Overdue work, deals without a next step, documents, and unread conversations.",
    allClearTitle: "Everything is under control",
    allClearHint:
      "There are no urgent tasks, overdue items, or unread conversations today.",
    localDataLabel: "Local EVO data",
    metricsLabel: "Key metrics",
    allApplications: "All applications",
  },
};

export function getDashboardCopy(locale: Locale) {
  return DASHBOARD_COPY[locale];
}
