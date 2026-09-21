import { universityUuid } from "./platform-university-catalog.ts";

export type StaffUniversityCountries = Readonly<{
  organizationId: string;
  countries: readonly string[];
}>;

/** Complete staff facet, independent of the filtered or paginated card list. */
export function parseStaffUniversityCountries(value: unknown, organizationId: string): StaffUniversityCountries | null {
  if (!universityUuid(organizationId) || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || !Object.hasOwn(row, "organizationId") || !Object.hasOwn(row, "countries")
    || row.organizationId !== organizationId || !Array.isArray(row.countries) || row.countries.length > 676) return null;
  const countries: string[] = [];
  for (const code of row.countries) {
    if (typeof code !== "string" || code.length !== 2 || !/^[A-Z]{2}$/.test(code)
      || (countries.length > 0 && countries[countries.length - 1] >= code)) return null;
    countries.push(code);
  }
  return { organizationId, countries };
}

/** Preserve a valid deep-link choice even when its last publication disappears. */
export function staffUniversityCountryOptions(countries: readonly string[], selected: string) {
  const options = countries.map((code) => ({ code, unavailable: false }));
  if (selected && !countries.includes(selected)) options.push({ code: selected, unavailable: true });
  return options;
}
