export const LOCALES = ["ru", "ky", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  ky: "Кыргызча",
  en: "English",
};

export type Dict = Record<string, string>;

const ru: Dict = {
  logout: "Выйти",
  name: "Имя и фамилия",
  role: "Роль",
  "role.admin": "Руководство",
  "role.sales": "Продажи",
  "role.admissions": "Поступление",
  toggleTheme: "Сменить тему",
};

const ky: Dict = {
  logout: "Чыгуу",
  name: "Аты-жөнү",
  role: "Роль",
  "role.admin": "Жетекчилик",
  "role.sales": "Сатуу",
  "role.admissions": "Кабыл алуу",
  toggleTheme: "Теманы алмаштыруу",
};

const en: Dict = {
  logout: "Log out",
  name: "Full name",
  role: "Role",
  "role.admin": "Management",
  "role.sales": "Sales",
  "role.admissions": "Admissions",
  toggleTheme: "Toggle theme",
};

export const DICTS: Record<Locale, Dict> = { ru, ky, en };
