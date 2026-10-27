import { notFound } from "next/navigation";
import { UniversityShell } from "@/components/v3/universities-next/UniversityShell";
import { UniversityDetailNextLazy } from "@/components/v3/universities-next/UniversitiesNextLazy";
import { universityPlaceText, universityPrograms, universityVerified } from "@/components/v3/universities-next/university-detail-model";
import { UniversityPhoto } from "@/components/v3/universities/UniversityPhoto";
import { isNextUi } from "@/lib/ui-next";
import { UniversityBackLink, UniversityContentView, UniversityManageLinks, UniversityPlace, UniversityUnavailable, universityCountry } from "@/components/v3/universities/UniversityCatalogue";
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
  const nextUi = await isNextUi(actor);
  const canManage = canManageCatalogGeography(actor);
  // Город и стоимость (план 7.5) читаются рядом с карточкой и только у того, кто может их править.
  const [page, geography] = await Promise.all([
    readStaffUniversities(actor, undefined, id).catch(() => null),
    canManage ? readStaffCatalogGeography(actor).catch(() => null) : Promise.resolve(undefined),
  ]);
  if (!page) return <UniversityShell nextUi={nextUi} title="Университет" back={<UniversityBackLink />}><UniversityUnavailable /></UniversityShell>;
  const university = page.items[0] ?? notFound();
  // «Новый вид»: те же программы, наборы и панель города и стоимости, карточки набора виджетов; сроки считает сервер.
  if (nextUi) {
    const now = new Date();
    const { content } = university;
    return (
      <UniversityDetailNextLazy
        name={content.name}
        place={universityPlaceText(content, universityCountry(content.country))}
        programs={universityPrograms(content, now)}
        overview={content.overview}
        websiteUrl={content.websiteUrl}
        sourceUrl={content.sourceUrl}
        verified={universityVerified(content, now)}
        photo={<UniversityPhoto content={content} variant="side" />}
        canManage={canManage}
        manage={canManage ? { formsHref: `/v3/universities/${id}/forms`, editHref: `/v3/universities/manage?edit=${id}` } : null}
      >
        {geography === undefined ? null : (
          <UniversityGeographyPanel
            institutionId={id}
            content={content}
            geography={geography}
            canConfirm={canConfirmAgencyCosts(actor)}
            today={now.toISOString().slice(0, 10)}
          />
        )}
      </UniversityDetailNextLazy>
    );
  }
  // Э6: возврат к каталогу — над заголовком; страна, город и число программ —
  // сразу под названием; управление Admin — тихими ссылками после них (на
  // телефоне — ниже строки места); сначала программы и наборы.
  // Город и стоимость для кабинета студента идут после карточки, только у редактора.
  return (
    <UniversityShell nextUi={false} title={university.content.name} back={<UniversityBackLink />} meta={<UniversityPlace content={university.content} />}
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
    </UniversityShell>
  );
}
