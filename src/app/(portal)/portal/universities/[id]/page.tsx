import { notFound } from "next/navigation";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";

import { UniversitiesUnavailable } from "@/components/portal/universities/Catalog";
import { UniversityDetailView } from "@/components/portal/universities/Detail";
import { getLocale } from "@/lib/i18n";
import { universityUuid } from "@/lib/platform-university-catalog";
import { openConsultationRequest, type ConsultationReceipt } from "@/lib/portal/consultation";
import { readOwnConsultationRequests } from "@/lib/portal/consultation-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readStudentUniversityFavorites } from "@/lib/portal/university-favorites-source";
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
  // Четыре независимых чтения — одним заходом (план A, 16.10.2026): каждое
  // RPC само проверяет живого студента; результат рисуется только после
  // проверки доступа выше. Семантика сбоев прежняя.
  const [pageRead, preparations, favoriteIds, consultationRead] = await Promise.all([
    readStudentUniversities(actor, undefined, id).then((value) => ({ ok: true as const, value }), () => ({ ok: false as const })),
    readStudentCatalogPreparations(actor.studentCaseId).catch(() => null),
    // Сбой чтения избранного не роняет карточку: toggle честно скрывается
    // вместо ложного «не сохранено» (PORT-3b).
    readStudentUniversityFavorites().then((favorites) => favorites.map((favorite) => favorite.institutionId)).catch(() => null),
    // Запрос консультации (PORT-5b): открытый запрос показывается честно уже
    // при загрузке; сбой чтения истории скрывает блок, а не рисует ложное
    // «запроса нет» — submit остаётся доступным из профиля.
    readOwnConsultationRequests()
      .then((requests) => ({ available: true as const, openRequest: openConsultationRequest(requests) }))
      .catch(() => ({ available: false as const, openRequest: null })),
  ]);
  if (!pageRead.ok) {
    return (
      <main className="pt-page">
        <UniversitiesUnavailable strings={strings} />
      </main>
    );
  }
  const university = pageRead.value.items[0] ?? notFound();
  const favored: boolean | null = favoriteIds === null ? null : favoriteIds.includes(university.id);
  const openRequest: ConsultationReceipt | null = consultationRead.openRequest;
  const consultationAvailable = consultationRead.available;
  return (
    <main className="pt-page">
      <UniversityDetailView
        university={university}
        base="/portal/universities"
        strings={strings}
        locale={locale}
        now={new Date()}
        favored={favored}
        selection={{
          scope: { organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: actor.studentCaseId },
          canSelect: actor.caseState === "active" && Boolean(actor.portalActivatedAt),
          bindings: preparations?.map(({ applicationId, institutionId, programId, intakeId }) => ({ applicationId, institutionId, programId, intakeId })) ?? null,
          strings: getPortalStrings("preparations", locale),
        }}
        consultation={consultationAvailable ? {
          initialOpenRequest: openRequest,
          strings: getPortalStrings("consultation", locale),
        } : null}
      />
    </main>
  );
}
