import { notFound } from "next/navigation";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { UniversityList, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { parseUniversityFilters } from "@/lib/platform-university-catalog";
import { readStudentUniversities } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [actor, params] = await Promise.all([requireStudentPortalActor(), searchParams]);
  const filters = parseUniversityFilters(params) ?? notFound();
  let page;
  try { page = await readStudentUniversities(actor, filters); } catch { return <PortalPage title="Университеты" description="Проверенные сведения для выбора направления."><UniversityUnavailable /></PortalPage>; }
  return <PortalPage title="Университеты" description="Изучайте программы и сравнивайте условия. Подходящий маршрут и возможность подачи можно обсудить с куратором."><UniversityList page={page} filters={filters} base="/portal/universities" /></PortalPage>;
}
