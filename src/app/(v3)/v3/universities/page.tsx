import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { notFound } from "next/navigation";
import Link from "next/link";
import { btnCls } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityList, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { parseUniversityFilters } from "@/lib/platform-university-catalog";
import { readStaffUniversities, readStaffUniversityCountries } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [actor, params] = await Promise.all([requireV3PageActor("/v3/universities"), searchParams]);
  const filters = parseUniversityFilters(params) ?? notFound();
  const canManage = !isStaffPreview(actor) && staffHasPermission(actor, "catalog.import.manage");
  const manageAction = canManage ? <Link className={btnCls} href="/v3/universities/manage">Управлять каталогом</Link> : undefined;
  let page, facet;
  try { [page, facet] = await Promise.all([readStaffUniversities(actor, filters), readStaffUniversityCountries(actor)]); } catch { return <PartShell title="Университеты" action={manageAction}><UniversityUnavailable /></PartShell>; }
  const now = new Date();
  return <PartShell title="Университеты" action={manageAction}><UniversityList page={page} filters={filters} base="/v3/universities" countries={facet.countries} canManage={canManage} now={now} /></PartShell>;
}
