import { universityUuid } from "../platform-university-catalog.ts";

export type RecentUniversity = Readonly<{
  id: string;
  name: string;
  country: string;
  city: string | null;
  firstPublishedAt: string;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Reject an invalid/partial response; never reinterpret a read failure as no news. */
export function parseRecentUniversities(value: unknown): readonly RecentUniversity[] | null {
  const page = record(value);
  if (!page || Object.keys(page).length !== 1 || !Array.isArray(page.items) || page.items.length > 4) return null;
  const result: RecentUniversity[] = [];
  const ids = new Set<string>();
  for (const value of page.items) {
    const row = record(value);
    if (!row || Object.keys(row).length !== 5) return null;
    const id = universityUuid(row.id);
    if (!id || ids.has(id) || !text(row.name, 300)
      || typeof row.country !== "string" || !/^[A-Z]{2}$/u.test(row.country)
      || !(row.city === null || text(row.city, 200))
      || typeof row.firstPublishedAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(row.firstPublishedAt)
      || !Number.isFinite(Date.parse(row.firstPublishedAt))) return null;
    ids.add(id);
    result.push({ id, name: row.name, country: row.country, city: row.city, firstPublishedAt: row.firstPublishedAt });
  }
  return result;
}
