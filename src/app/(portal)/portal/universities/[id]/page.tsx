import { notFound } from "next/navigation";

import { UniversitiesUnavailable } from "@/components/portal/universities/Catalog";
import { UniversityDetailView } from "@/components/portal/universities/Detail";
import { getLocale } from "@/lib/i18n";
import { universityUuid } from "@/lib/platform-university-catalog";
import { getPortalStrings } from "@/lib/portal/i18n";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readStudentUniversities } from "@/lib/v3/university-source";

export const dynamic = "force-dynamic";

/**
 * Карточка вуза в стиле «Атлас» (PORT-3a). Заголовок — фото-герой с
 * атрибуцией; состав фактов (обзор, программы, интейки, источники) полностью
 * сохранён; текст — портальный словарь RU/KY (нейтральное описание
 * `universities.detailLead`).
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
  let page;
  try {
    page = await readStudentUniversities(actor, undefined, id);
  } catch {
    return (
      <main className="pt-page">
        <UniversitiesUnavailable strings={strings} />
      </main>
    );
  }
  const university = page.items[0] ?? notFound();
  return (
    <main className="pt-page">
      <UniversityDetailView
        university={university}
        base="/portal/universities"
        strings={strings}
        locale={locale}
        now={new Date()}
      />
    </main>
  );
}
