import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readApplicationPartnerDetails } from "@/lib/v3/admissions-source";
import { ProfileAdmissionsWorkspacePanel } from "./ProfileAdmissionsWorkspace";
import { ProfileHandoffAcknowledgement } from "./ProfileSalesTransition";
import type { ProfileDraft } from "./types";
import { PartnerPacketsPanel } from "./PartnerPacketsPanel";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { readStaffPreparationsAction } from "@/lib/v3/staff-catalog-preparation-actions";
import { StaffCatalogPreparationPicker } from "./StaffCatalogPreparationPicker";

/**
 * Вкладка «Вузы и программы» (unified workflow S4, plan §8, §11) — заменяет
 * «Маршрут»; URL-контракт `?tab=route` сохранён (пин
 * `tests/v3-operational-parity.test.mjs`, ссылка из `CuratorDay.tsx`),
 * меняется только заголовок и содержимое.
 *
 * Рассматриваемые/выбранные вузы и программы (`ProfileAdmissionsWorkspacePanel`
 * — уже в `draft.admissions`, без нового чтения) и пакеты партнёру
 * (`PartnerPacketsPanel`) — независимые разделы: читаются и падают порознь,
 * как и раньше. Партнёрские факты, оставшиеся от старого редактора маршрута
 * (`readApplicationPartnerDetails`), — отдельный, необязательный для успеха
 * вкладки запрос со своим `catch`: недоступность этих нескольких read-only
 * полей не гасит уже загруженные заявки и пакеты.
 *
 * Маршрут, этапы, плейбук, сообщения и визовое дело (форма) сюда не
 * переехали — они убраны вместе с обязательным трекером поступления
 * (plan §8, §13). Заявки/статус и пакеты партнёру не требуют выбора
 * маршрута: их можно вести без него.
 */
export async function UniversityProgramsTab({
  actor,
  draft,
  packetsInitiallyOpen = false,
}: {
  actor: ActivePlatformActor;
  draft: ProfileDraft;
  packetsInitiallyOpen?: boolean;
}) {
  const caseId = draft.admissions?.studentCaseId;
  if (!caseId || actor.presentationRole === "sales") return null;
  const [partnerDetails, preparations] = await Promise.all([
    readApplicationPartnerDetails(actor, caseId).catch(() => []),
    readStaffPreparationsAction(caseId).catch(() => ({ status: "unavailable" as const })),
  ]);
  const preview = isStaffPreview(actor);
  const canSelect = !preview && draft.admissions?.caseState === "active" && staffHasPermission(actor, "application.manage");
  const scope = { organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: caseId };

  return (
    <div className="space-y-5" data-testid="v3-universities-programs">
      {draft.handoffAcknowledgement ? <ProfileHandoffAcknowledgement snapshot={draft.handoffAcknowledgement} /> : null}

      <section id="admissions-workspace" className="space-y-3">
        <h3 className="t-item text-fg">Вузы и программы</h3>
        <p className="text-sm leading-6 text-fg-2">
          Добавьте рассматриваемые варианты и отметьте основной. Выбор университета не означает подачу документов.
        </p>
        {!preview && staffHasPermission(actor, "catalog.read") ? <StaffCatalogPreparationPicker
          key={`${actor.membershipId}:${caseId}`}
          scope={scope}
          canSelect={canSelect}
          canInitialize={canSelect && staffHasPermission(actor, "document.read.full") && staffHasPermission(actor, "document.manage")}
          initialPreparations={preparations}
        /> : <p className="text-sm text-fg-3">{preview ? "Выбор из каталога недоступен в режиме предпросмотра." : "Нет доступа к каталогу. Сохранённые заявки доступны ниже по правам дела."}</p>}
        <ProfileAdmissionsWorkspacePanel actor={actor} workspace={draft.admissions} partnerDetails={partnerDetails} preparations={preparations} />
      </section>

      <PartnerPacketsPanel
        actor={actor}
        caseId={caseId}
        active={draft.admissions?.caseState === "active"}
        initiallyOpen={packetsInitiallyOpen}
        applications={(draft.admissions?.applications ?? []).map((application) => ({
          id: application.universityApplicationId,
          name: application.programName ? `${application.institutionName} · ${application.programName}` : application.institutionName,
        }))}
      />
    </div>
  );
}
