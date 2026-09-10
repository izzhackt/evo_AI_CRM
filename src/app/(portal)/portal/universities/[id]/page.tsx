import { notFound } from "next/navigation";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { UniversityDetail, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { universityUuid } from "@/lib/platform-university-catalog";
import { readStudentUniversities } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
export default async function UniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const [actor, route] = await Promise.all([requireStudentPortalActor(), params]);
  const id = universityUuid(route.id) ?? notFound();
  let page;
  try { page = await readStudentUniversities(actor, undefined, id); } catch { return <PortalPage title="Университет" description="Публичная карточка университета."><UniversityUnavailable /></PortalPage>; }
  const university = page.items[0] ?? notFound();
  return <PortalPage title={university.content.name} description="Проверьте программу, ближайший набор и сведения, которые ещё нужно уточнить."><UniversityDetail university={university} base="/portal/universities" now={new Date()} /></PortalPage>;
}
