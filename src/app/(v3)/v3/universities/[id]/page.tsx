import { notFound } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityBackLink, UniversityContentView, UniversityManageLinks, UniversityPlace, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { UniversityGeographyPanel } from "@/components/v3/universities/geography/UniversityGeographyPanel";
import { requireV3PageActor } from "@/lib/platform-guards";
import { universityUuid } from "@/lib/platform-university-catalog";
import { canConfirmAgencyCosts, canManageCatalogGeography, readStaffCatalogGeography } from "@/lib/v3/catalog-geography-source";
import { readStaffUniversities } from "@/lib/v3/university-source";
export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };
export default async function UniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const [actor, route] = await Promise.all([requireV3PageActor("/v3/universities"), params]);
  const id = universityUuid(route.id) ?? notFound();
  const canManage = canManageCatalogGeography(actor);
  // Город и стоимость (план 7.5) читаются рядом с карточкой и только у того, кто может их править.
  const [page, geography] = await Promise.all([
    readStaffUniversities(actor, undefined, id).catch(() => null),
    canManage ? readStaffCatalogGeography(actor).catch(() => null) : Promise.resolve(undefined),
  ]);
  if (!page) return <PartShell title="Университет" back={<UniversityBackLink />}><UniversityUnavailable /></PartShell>;
  const university = page.items[0] ?? notFound();
  // Э6: возврат к каталогу — над заголовком; страна, город и число программ —
  // сразу под названием; управление Admin — тихими ссылками после них (на
  // телефоне — ниже строки места); сначала программы и наборы.
  // Город и стоимость для кабинета студента идут после карточки, только у редактора.
  return (
    <PartShell title={university.content.name} back={<UniversityBackLink />} meta={<UniversityPlace content={university.content} />}
      action={canManage ? <UniversityManageLinks id={id} formsHref={`/v3/universities/${id}/forms`} /> : undefined}>
      <UniversityContentView content={university.content} now={new Date()} placeInHeader />
      {geography === undefined ? null : (
        <UniversityGeographyPanel
          institutionId={id}
          content={university.content}
          geography={geography}
          canConfirm={canConfirmAgencyCosts(actor)}
          today={new Date().toISOString().slice(0, 10)}
        />
      )}
    </PartShell>
  );
}
