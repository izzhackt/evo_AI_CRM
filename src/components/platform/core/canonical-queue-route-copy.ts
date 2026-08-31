import type { Locale } from "@/lib/i18n-data";

export type CanonicalQueueRoute =
  | "applications"
  | "visa"
  | "finance"
  | "tasks";

export type CanonicalQueueRouteCopy = Readonly<{
  loadingTitle: string;
  loadingHint: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  backToQueue: string;
}>;

export const CANONICAL_QUEUE_ROUTE_COPY: Readonly<
  Record<CanonicalQueueRoute, Readonly<Record<Locale, CanonicalQueueRouteCopy>>>
> = {
  applications: {
    ru: {
      loadingTitle: "Загружаем заявки в университеты",
      loadingHint: "Читаем актуальную очередь из PostgreSQL V2.",
      errorTitle: "Заявки временно недоступны",
      errorDescription:
        "PostgreSQL не ответил. Старый источник или резервный экран не используется.",
      retry: "Повторить",
      backToQueue: "К очереди заявок",
    },
    ky: {
      loadingTitle: "Университет арыздары жүктөлүүдө",
      loadingHint: "PostgreSQL V2 базасынан учурдагы кезек окулууда.",
      errorTitle: "Арыздар убактылуу жеткиликсиз",
      errorDescription:
        "PostgreSQL жооп берген жок. Эски булак же резервдик экран колдонулбайт.",
      retry: "Кайра аракет кылуу",
      backToQueue: "Арыздар кезегине",
    },
    en: {
      loadingTitle: "Loading university applications",
      loadingHint: "Reading the current queue from PostgreSQL V2.",
      errorTitle: "Applications are temporarily unavailable",
      errorDescription:
        "PostgreSQL did not respond. No legacy source or fallback screen is used.",
      retry: "Try again",
      backToQueue: "Back to applications",
    },
  },
  visa: {
    ru: {
      loadingTitle: "Загружаем визовый контроль",
      loadingHint: "Читаем актуальные визовые этапы из PostgreSQL V2.",
      errorTitle: "Визовый контроль временно недоступен",
      errorDescription:
        "PostgreSQL не ответил. Старый источник или резервный экран не используется.",
      retry: "Повторить",
      backToQueue: "К визовому контролю",
    },
    ky: {
      loadingTitle: "Виза көзөмөлү жүктөлүүдө",
      loadingHint: "PostgreSQL V2 базасынан учурдагы виза этаптары окулууда.",
      errorTitle: "Виза көзөмөлү убактылуу жеткиликсиз",
      errorDescription:
        "PostgreSQL жооп берген жок. Эски булак же резервдик экран колдонулбайт.",
      retry: "Кайра аракет кылуу",
      backToQueue: "Виза көзөмөлүнө",
    },
    en: {
      loadingTitle: "Loading visa control",
      loadingHint: "Reading the current visa stages from PostgreSQL V2.",
      errorTitle: "Visa control is temporarily unavailable",
      errorDescription:
        "PostgreSQL did not respond. No legacy source or fallback screen is used.",
      retry: "Try again",
      backToQueue: "Back to visa control",
    },
  },
  finance: {
    ru: {
      loadingTitle: "Загружаем финансовые стопы",
      loadingHint: "Читаем актуальные стопы и решения из PostgreSQL V2.",
      errorTitle: "Финансовый контроль временно недоступен",
      errorDescription:
        "PostgreSQL не ответил. Старый источник или резервный экран не используется.",
      retry: "Повторить",
      backToQueue: "К финансовым стопам",
    },
    ky: {
      loadingTitle: "Каржылык токтотуулар жүктөлүүдө",
      loadingHint: "PostgreSQL V2 базасынан учурдагы токтотуулар жана чечимдер окулууда.",
      errorTitle: "Каржылык көзөмөл убактылуу жеткиликсиз",
      errorDescription:
        "PostgreSQL жооп берген жок. Эски булак же резервдик экран колдонулбайт.",
      retry: "Кайра аракет кылуу",
      backToQueue: "Каржылык токтотууларга",
    },
    en: {
      loadingTitle: "Loading finance stops",
      loadingHint: "Reading the current stops and decisions from PostgreSQL V2.",
      errorTitle: "Finance control is temporarily unavailable",
      errorDescription:
        "PostgreSQL did not respond. No legacy source or fallback screen is used.",
      retry: "Try again",
      backToQueue: "Back to finance stops",
    },
  },
  tasks: {
    ru: {
      loadingTitle: "Загружаем задачи команды",
      loadingHint: "Читаем актуальную очередь задач из PostgreSQL V2.",
      errorTitle: "Задачи временно недоступны",
      errorDescription:
        "PostgreSQL не ответил. Старый источник или резервный экран не используется.",
      retry: "Повторить",
      backToQueue: "К задачам",
    },
    ky: {
      loadingTitle: "Команданын тапшырмалары жүктөлүүдө",
      loadingHint: "PostgreSQL V2 базасынан учурдагы тапшырмалар кезеги окулууда.",
      errorTitle: "Тапшырмалар убактылуу жеткиликсиз",
      errorDescription:
        "PostgreSQL жооп берген жок. Эски булак же резервдик экран колдонулбайт.",
      retry: "Кайра аракет кылуу",
      backToQueue: "Тапшырмаларга",
    },
    en: {
      loadingTitle: "Loading team tasks",
      loadingHint: "Reading the current task queue from PostgreSQL V2.",
      errorTitle: "Tasks are temporarily unavailable",
      errorDescription:
        "PostgreSQL did not respond. No legacy source or fallback screen is used.",
      retry: "Try again",
      backToQueue: "Back to tasks",
    },
  },
};
