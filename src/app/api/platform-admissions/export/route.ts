import { loadAdmissionsCases } from "../../../(staff)/admissions/admissions-data.ts";
import {
  admissionsCsvOrder,
  filterAdmissionsCases,
  parseAdmissionsFilter,
  serializeAdmissionsCsv,
} from "../../../../lib/platform-admissions-filters.ts";

/**
 * CSV of the admissions funnel, filtered exactly as the screen was.
 *
 * A GET is correct here: this reads and changes nothing, and it returns only
 * rows the same reader already sees on `/admissions`. Authorization is not
 * re-implemented — `loadAdmissionsCases` runs the same guard and the same
 * RLS-scoped query the page does, so this route cannot widen anyone's view.
 */

const MAX_COUNTRY_LENGTH = 200;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function headers(filename: string): Headers {
  return new Headers({
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
}

function country(value: string | null): string | null {
  if (value === null) return null;
  const candidate = value.trim();
  if (
    candidate.length < 1
    || candidate.length > MAX_COUNTRY_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  for (const key of ["from", "to", "curator"]) {
    const value = url.searchParams.get(key);
    if (value !== null) params[key] = value;
  }
  const filter = parseAdmissionsFilter(params);
  const requestedCountry = country(url.searchParams.get("country"));

  const allCases = await loadAdmissionsCases();
  const scoped = requestedCountry === null
    ? allCases
    : allCases.filter((row) => row.targetCountry.trim() === requestedCountry);
  const rows = admissionsCsvOrder(filterAdmissionsCases(scoped, filter));

  // The filename carries no user-supplied text, so a crafted country name
  // cannot reach the Content-Disposition header.
  return new Response(serializeAdmissionsCsv(rows), {
    status: 200,
    headers: headers("evo-admissions.csv"),
  });
}

export async function POST(): Promise<Response> {
  return new Response(null, { status: 405, headers: { allow: "GET" } });
}
