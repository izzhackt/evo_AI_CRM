import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { PacketWorkspace } from "@/lib/platform-admissions-support-contract";
import { readApplicationPartnerDetails } from "@/lib/v3/admissions-source";
import { readPartnerPackets } from "@/lib/v3/case-operations-source";
import { ProfileAdmissionsWorkspacePanel } from "./ProfileAdmissionsWorkspace";
import { ProfileHandoffAcknowledgement } from "./ProfileSalesTransition";
import type { ApplicationPartnerDetails, ProfileDraft } from "./types";
import { PartnerPacketsPanel } from "./PartnerPacketsPanel";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { readStaffPreparationsAction, type StaffPreparationRead } from "@/lib/v3/staff-catalog-preparation-actions";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import { ApplicationCreateDialog } from "./ApplicationCreateDialog";
import { CatalogPreparationLauncher } from "./StaffCatalogPreparationPicker";
import { casePrimaryAction } from "./case-work-view";
import { studentsHandoffPending } from "../students/students-queue-view";

/**
 * Вкладка «Вузы и программы» (unified workflow S4, plan §8, §11) — заменяет
 * «Маршрут»; URL-контракт `?tab=route` сохранён (пин
 * `tests/v3-operational-parity.test.mjs`, ссылка из `CuratorDay.tsx`),
 * меняется только заголовок и содержимое.
 *
 * Чтения — порознь, как и раньше: партнёрские факты заявок
 * (`readApplicationPartnerDetails`), сохранённые подготовки из каталога и
 * пакеты партнёру падают каждое со своим `catch` и не гасят уже загруженные
 * заявки. Разметку рисует `UniversityProgramsView` без запросов — её же
 * рендерит статический рендер вкладки с синтетикой.
 */
export async function UniversityProgramsTab({
  actor,
  draft,
  routeHref,
  packetsInitiallyOpen = false,
  packetApplicationId = null,
}: {
  actor: ActivePlatformActor;
  draft: ProfileDraft;
  /** Адрес этой вкладки с возвратом (`hrefFor("route")`) — для «⋯ → Пакет партнёру». */
  routeHref: string;
  packetsInitiallyOpen?: boolean;
  /** `packet_application` адреса: заявка, выбранная в форме пакета (проверяется по заявкам дела). */
  packetApplicationId?: string | null;
}) {
  const caseId = draft.admissions?.studentCaseId;
  if (!caseId || actor.presentationRole === "sales") return null;
  const [partnerDetails, preparations, packets] = await Promise.all([
    readApplicationPartnerDetails(actor, caseId).catch(() => []),
    readStaffPreparationsAction(caseId).catch(() => ({ status: "unavailable" as const })),
    readPartnerPackets(actor, caseId).catch(() => null),
  ]);
  return (
    <UniversityProgramsView actor={actor} draft={draft} routeHref={routeHref} partnerDetails={partnerDetails}
      preparations={preparations} packets={packets} packetsInitiallyOpen={packetsInitiallyOpen}
      packetApplicationId={packetApplicationId} nowIso={new Date().toISOString()} />
  );
}

/**
 * «Вузы и программы» (Э8.2, решение владельца 28.09.2026) из уже прочитанного:
 *
 * - один список вузов дела (`ProfileAdmissionsWorkspacePanel`): вариант из
 *   каталога и добавленный вручную вуз вместе с заявкой, путь «вариант →
 *   заявка подана → решение», срок подачи, кто добавил, «⋯» строки;
 * - одна кнопка добавления «+ Вуз из каталога» (прежний выбор программы и
 *   набора в окне); сплошная красная — только когда у заголовка дела нет
 *   «Принять дело» (одно главное действие на странице), иначе нейтральная;
 *   ручной ввод — тихой ссылкой «Добавить вручную» (каталог — шесть стран),
 *   на узком экране она под кнопкой;
 * - пакеты партнёру — раскрытием под списком, если у дела есть заявления.
 *
 * «Приём дела» здесь только на странице лида (`?id=`): там у заголовка нет
 * «Принять дело», и ответить на передачу больше негде. На странице дела
 * (`?case=`) ответ — у заголовка («Принять дело») и в «Сведениях» «Обзора».
 * Роль просмотра «Продажи» вкладку не видит.
 */
export function UniversityProgramsView({
  actor,
  draft,
  routeHref,
  partnerDetails,
  preparations,
  packets,
  packetsInitiallyOpen = false,
  packetApplicationId = null,
  nowIso,
}: {
  actor: ActivePlatformActor;
  draft: ProfileDraft;
  routeHref: string;
  partnerDetails: readonly ApplicationPartnerDetails[];
  preparations: StaffPreparationRead<readonly CatalogPreparation[]>;
  packets: PacketWorkspace | null;
  packetsInitiallyOpen?: boolean;
  packetApplicationId?: string | null;
  nowIso: string;
}) {
  const admissions = draft.admissions;
  if (!admissions || actor.presentationRole === "sales") return null;
  const caseId = admissions.studentCaseId;
  const preview = isStaffPreview(actor);
  const active = admissions.caseState === "active";
  const canWriteApplications = !preview && active && staffHasPermission(actor, "application.manage");
  const canSelect = canWriteApplications && staffHasPermission(actor, "catalog.read");
  const scope = { organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: caseId };
  const handoff = draft.handoffAcknowledgement;
  const casePage = draft.routeTarget.studentCaseId !== null;
  // Одно главное действие страницы: на деле это «Принять дело» у заголовка, пока дело ждёт
  // ответа куратора; на странице лида у заголовка своё действие — там кнопка всегда нейтральная.
  const catalogueIsMain = casePage && casePrimaryAction({
    handoffPending: handoff !== null && studentsHandoffPending(handoff), preview,
  }) === null;
  const applications = admissions.applications.map((application) => ({
    id: application.universityApplicationId,
    name: application.programName ? `${application.institutionName} · ${application.programName}` : application.institutionName,
  }));

  const toolbar = canWriteApplications ? (
    <>
      {/* Не <p>: окно ручного ввода (<dialog>) рисуется рядом со своей кнопкой. Узкий экран: сначала
          главная кнопка, тихая ссылка — под ней; с 48rem — ссылка перед кнопкой в одной строке. */}
      <div className="order-last flex flex-wrap items-center gap-x-1.5 t-body-compact text-fg-2 @min-[48rem]/unis:order-none">
        {canSelect ? <span>Вуза нет в каталоге?</span> : null}
        <ApplicationCreateDialog workspace={admissions} />
      </div>
      {canSelect ? (
        <CatalogPreparationLauncher
          key={`${actor.membershipId}:${caseId}`}
          primary={catalogueIsMain}
          scope={scope}
          canSelect={canSelect}
          canInitialize={canSelect && staffHasPermission(actor, "document.read.full") && staffHasPermission(actor, "document.manage")}
          initialPreparations={preparations}
        />
      ) : null}
    </>
  ) : null;

  return (
    <div className="space-y-6" data-testid="v3-universities-programs">
      {handoff && !casePage ? <ProfileHandoffAcknowledgement snapshot={handoff} /> : null}
      <ProfileAdmissionsWorkspacePanel
        actor={actor}
        workspace={admissions}
        partnerDetails={partnerDetails}
        preparations={preparations}
        nowIso={nowIso}
        packetsHref={routeHref}
        toolbar={toolbar}
      />
      {/* Без заявлений пакет собрать не из чего — раскрытия нет. */}
      {applications.length ? (
        <PartnerPacketsPanel
          caseId={caseId}
          active={active}
          applications={applications}
          workspace={packets}
          initiallyOpen={packetsInitiallyOpen}
          initialApplicationId={applications.some((application) => application.id === packetApplicationId) ? packetApplicationId : null}
        />
      ) : null}
    </div>
  );
}
