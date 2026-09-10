import { notFound } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityDetail, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { universityUuid } from "@/lib/platform-university-catalog";
import { readStaffUniversities } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
export default async function UniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const [actor, route] = await Promise.all([requireV3PageActor("/v3/universities"), params]);
  const id = universityUuid(route.id) ?? notFound();
  let page;
  try { page = await readStaffUniversities(actor, undefined, id); } catch { return <PartShell title="Университет"><UniversityUnavailable /></PartShell>; }
  const university = page.items[0] ?? notFound();
  return <PartShell title={university.content.name}><UniversityDetail university={university} base="/v3/universities" canManage={actor.authorityRole === "admin" && actor.presentationRole === "admin"} now={new Date()} /></PartShell>;
}
