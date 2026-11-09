// Модель экрана лицензий: форма сгенерированного JSON (scripts/generate-licenses.mjs) и поиск.
export type LicenseEntry = Readonly<{
  name: string;
  version: string;
  license: string;
  url: string;
  kind: "npm" | "asset";
  /** Ключ в `texts`; `null`, если в пакете нет файла лицензии. */
  text: string | null;
}>;

export type LicenseData = Readonly<{ packages: readonly LicenseEntry[]; texts: Readonly<Record<string, string>> }>;

/** JSON разбирается при открытии экрана, а не при запуске приложения (≈600 КБ). */
export function loadLicenses(): LicenseData {
  return require("./licenses.generated.json") as LicenseData;
}

/** Записи вне npm (шрифты, карта, данные) идут первыми, дальше пакеты по имени. */
export function filterLicenses(data: LicenseData, query: string): readonly LicenseEntry[] {
  const q = query.trim().toLowerCase();
  const list = q ? data.packages.filter((p) => p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q)) : data.packages;
  return [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "asset" ? -1 : 1));
}

/** Только http(s): ссылка из данных не должна открывать другие схемы. */
export function safeProjectUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}
