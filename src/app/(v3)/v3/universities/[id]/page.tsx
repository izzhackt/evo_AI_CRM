import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { notFound } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityBackLink, UniversityContentView, UniversityManageLinks, UniversityPlace, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { universityUuid } from "@/lib/platform-university-catalog";
import { readStaffUniversities } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };
export default async function UniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const [actor, route] = await Promise.all([requireV3PageActor("/v3/universities"), params]);
  const id = universityUuid(route.id) ?? notFound();
  let page;
  try { page = await readStaffUniversities(actor, undefined, id); } catch { return <PartShell title="Университет" back={<UniversityBackLink />}><UniversityUnavailable /></PartShell>; }
  const university = page.items[0] ?? notFound();
  const canManage = !isStaffPreview(actor) && staffHasPermission(actor, "catalog.import.manage");
  // Э6: возврат к каталогу — над заголовком; страна, город и число программ —
  // сразу под названием; управление Admin — тихими ссылками после них (на
  // телефоне — ниже строки места); сначала программы и наборы.
  return (
    <PartShell title={university.content.name} back={<UniversityBackLink />} meta={<UniversityPlace content={university.content} />}
      action={canManage ? <UniversityManageLinks id={id} formsHref={`/v3/universities/${id}/forms`} /> : undefined}>
      <UniversityContentView content={university.content} now={new Date()} placeInHeader />
    </PartShell>
  );
}
