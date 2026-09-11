import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApplicationsView } from "@/components/v3/portal/ApplicationsView";
import { DocumentsView } from "@/components/v3/portal/DocumentsView";
import { OverviewView } from "@/components/v3/portal/OverviewView";
import { PaymentsView } from "@/components/v3/portal/PaymentsView";
import { PortalEmptyState, PortalPage } from "@/components/v3/portal/PortalPage";
import { PortalShell } from "@/components/v3/portal/PortalShell";
import { PortalAssessmentPreviewList, PortalAssessmentPreviewPage } from "@/components/v3/portal/assessments/AssessmentPreviewPage";
import { UniversityDetail, UniversityList, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isConnectedStudentPortalPreviewPage } from "@/lib/platform-route-contract";
import { parseUniversityFilters, universityUuid } from "@/lib/platform-university-catalog";
import { requireStudentPortalPreviewAuthority } from "@/lib/server/student-portal-preview";
import { readStaffUniversities } from "@/lib/v3/university-source";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Предпросмотр кабинета студента — EVO Admissions" };

type SearchParams = Record<string, string | string[] | undefined>;

async function UniversityPreview({ actor, id, params }: { actor: ActivePlatformActor; id?: string; params: SearchParams }) {
  const filters = parseUniversityFilters(params) ?? notFound();
  const universityId = id === undefined ? null : universityUuid(id) ?? notFound();
  let page;
  try {
    page = await readStaffUniversities(actor, filters, universityId);
  } catch {
    return <PortalPage title="Университеты" description="Действующий опубликованный каталог EVO."><UniversityUnavailable /></PortalPage>;
  }
  const base = "/preview/student/universities";
  if (universityId !== null) {
    const university = page.items[0] ?? notFound();
    return <PortalPage title={university.content.name} description="Программы, условия поступления и даты наборов."><UniversityDetail university={university} base={base} now={new Date()} /></PortalPage>;
  }
  return <PortalPage title="Университеты" description="Действующий опубликованный каталог. Здесь те же карточки, которые доступны студентам вашей организации."><UniversityList page={page} filters={filters} base={base} /></PortalPage>;
}

export default async function StudentPortalPreviewPage({ params, searchParams }: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<SearchParams>;
}) {
  // This is a page-level check, not a layout-only or presentation-role check.
  const actor = await requireStudentPortalPreviewAuthority();
  const { section = [] } = await params;
  const path = `/preview/student${section.length ? `/${section.join("/")}` : ""}`;
  if (!isConnectedStudentPortalPreviewPage(path)) notFound();

  let content;
  switch (section[0]) {
    case undefined:
      content = <PortalPage title="Моё поступление" description="Ваш следующий шаг и работа команды — под рукой."><OverviewView overview={null} preview /></PortalPage>;
      break;
    case "documents":
      content = <PortalPage title="Документы" description="Требования, загруженные файлы и результаты проверки."><DocumentsView documents={[]} /></PortalPage>;
      break;
    case "applications":
      content = <PortalPage title="Заявки и виза" description="Статусы университетских заявок, дедлайны и ход визового дела."><ApplicationsView applications={{ applications: [], visa: null }} /></PortalPage>;
      break;
    case "payments":
      content = <PortalPage title="Оплата" description="Платёжные обязательства и их текущие статусы."><PaymentsView payments={[]} /></PortalPage>;
      break;
    case "notifications":
      content = <PortalPage title="Уведомления" description="Опубликованные обновления по поступлению."><PortalEmptyState title="Новых уведомлений нет" description="Безопасные обновления по вашему поступлению появятся здесь." /></PortalPage>;
      break;
    case "universities":
      content = <UniversityPreview actor={actor} id={section[1]} params={await searchParams} />;
      break;
    case "tests":
      content = section[1] === undefined
        ? <PortalAssessmentPreviewList />
        : <PortalAssessmentPreviewPage kind={section[1] === "english" ? "english" : "career"} />;
      break;
    default:
      notFound();
  }

  return <PortalShell displayName={actor.displayName} preview>{content}</PortalShell>;
}
