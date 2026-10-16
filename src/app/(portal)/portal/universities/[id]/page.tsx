import { notFound } from "next/navigation";

import { UnavailableNotice } from "@/components/portal/universities/Places";
import { UniversityDetailView } from "@/components/portal/universities/Detail";
import { getLocale } from "@/lib/i18n";
import { universityUuid } from "@/lib/platform-university-catalog";
import { getPortalStrings } from "@/lib/portal/i18n";
import {
  cityHref,
  countryHref,
  localizedText,
  universityHref,
  UNIVERSITIES_BASE,
  type StudentUniversityDetail,
} from "@/lib/portal/university-index";
import { UniversityNotFoundError, readStudentUniversityDetail } from "@/lib/portal/university-index-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

/**
 * Страница вуза (PORT-3a, S3): один RPC `student_university_detail_v1`
 * вместо четырёх чтений: карточка, страна и город для пути по каталогу,
 * избранное, открытая консультация, подготовки и опубликованная стоимость.
 * Вуз чужой, неизвестный или вне шести стран: 404, как раньше.
 */
export default async function UniversityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [actor, route, locale] = await Promise.all([
    requireStudentPortalActor(),
    params,
    getLocale(),
  ]);
  const id = universityUuid(route.id) ?? notFound();
  const strings = getPortalStrings("universities", locale);
  let detail: StudentUniversityDetail;
  try {
    detail = await readStudentUniversityDetail(id);
  } catch (error) {
    if (error instanceof UniversityNotFoundError) notFound();
    return (
      <main className="pt-page">
        <UnavailableNotice strings={strings} href={universityHref(id)} />
      </main>
    );
  }
  const { university, country, city } = detail;
  const crumbs = [
    { label: strings.title, href: UNIVERSITIES_BASE },
    { label: localizedText(country.name, locale), href: countryHref(country.code) },
    ...(city ? [{ label: localizedText(city.name, locale), href: cityHref(country.code, city.key) }] : []),
  ];
  // Подготовки читаются в том же вызове; дело кабинета другое или не
  // читается: кнопка выбора честно не знает о прежнем выборе (как раньше).
  const preparations = detail.preparations?.studentCaseId === actor.studentCaseId ? detail.preparations.items : null;
  return (
    <main className="pt-page">
      <UniversityDetailView
        university={university}
        crumbs={crumbs}
        costs={detail.costs}
        strings={strings}
        locale={locale}
        now={new Date()}
        favored={detail.favored}
        selection={{
          scope: { organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: actor.studentCaseId },
          canSelect: actor.caseState === "active" && Boolean(actor.portalActivatedAt),
          bindings: preparations?.map(({ applicationId, institutionId, programId, intakeId }) => ({ applicationId, institutionId, programId, intakeId })) ?? null,
          strings: getPortalStrings("preparations", locale),
        }}
        consultation={{
          initialOpenRequest: detail.openConsultation,
          strings: getPortalStrings("consultation", locale),
        }}
      />
    </main>
  );
}
