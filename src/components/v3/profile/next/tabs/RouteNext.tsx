import type { ReactNode } from "react";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import type { StaffPreparationRead } from "@/lib/v3/staff-catalog-preparation-actions";

import { ProfileAdmissionsWorkspacePanel } from "../../ProfileAdmissionsWorkspace";
import { ProfileHandoffAcknowledgement } from "../../ProfileSalesTransition";
import type { ApplicationPartnerDetails, ProfileAdmissionsWorkspace as AdmissionsWorkspace, ProfileDraft } from "../../types";
import { NamedCard } from "../NamedCard";

type Handoff = ProfileDraft["handoffAcknowledgement"];

/**
 * «Вузы и программы» в «Новом виде»: список вузов дела - одна карточка (кнопки добавления у её заголовка), пакеты партнёру -
 * вторая. Строки, их «⋯», формы статуса и партнёра, подготовка документов и пакеты - прежние части с теми же командами и правами
 * (`ProfileAdmissionsWorkspacePanel bare`, `PartnerPacketsPanel nextUi`); новое - только рамка. `@container/unis` стоит на
 * карточке: по её ширине строки выбирают одну колонку или три.
 */
export function RouteNext({
  actor,
  admissions,
  partnerDetails,
  preparations,
  nowIso,
  routeHref,
  toolbar,
  handoff,
  casePage,
  packets,
}: Readonly<{
  actor: ActivePlatformActor;
  admissions: AdmissionsWorkspace;
  partnerDetails: readonly ApplicationPartnerDetails[];
  preparations: StaffPreparationRead<readonly CatalogPreparation[]>;
  nowIso: string;
  routeHref: string;
  toolbar: ReactNode;
  handoff: Handoff;
  /** Страница дела (`?case=`): там ответ на передачу - у заголовка и в «Сведениях», здесь его нет. */
  casePage: boolean;
  /** Пакеты партнёру: раскрытие под списком; нет заявлений - нет и его. */
  packets: ReactNode;
}>) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4" data-testid="v3-universities-programs">
      {handoff && !casePage ? <ProfileHandoffAcknowledgement snapshot={handoff} /> : null}
      <NamedCard
        title="Вузы и программы"
        id="applications"
        testId="v3-profile-admissions-workspace"
        className="@container/unis"
        actions={toolbar}
        count={admissions.applications.length || null}
      >
        <ProfileAdmissionsWorkspacePanel
          bare
          actor={actor}
          workspace={admissions}
          partnerDetails={partnerDetails}
          preparations={preparations}
          nowIso={nowIso}
          packetsHref={routeHref}
        />
      </NamedCard>
      {packets}
    </div>
  );
}
