import { notFound } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityList, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { parseUniversityFilters } from "@/lib/platform-university-catalog";
import { readStaffUniversities } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [actor, params] = await Promise.all([requireV3PageActor("/v3/universities"), searchParams]);
  const filters = parseUniversityFilters(params) ?? notFound();
  let page;
  try { page = await readStaffUniversities(actor, filters); } catch { return <PartShell title="Университеты"><UniversityUnavailable /></PartShell>; }
  return <PartShell title="Университеты"><UniversityList page={page} filters={filters} base="/v3/universities" canManage={actor.authorityRole === "admin" && actor.presentationRole === "admin"} /></PartShell>;
}
