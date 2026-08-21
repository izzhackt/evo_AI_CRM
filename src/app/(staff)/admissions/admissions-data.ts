import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import { listPlatformStudentCases } from "@/lib/platform-admissions";
import { requirePlatformAdmissionsActor } from "@/lib/platform-guards";
import type { AdmissionsCaseInput } from "@/lib/platform-admissions-overview";

/**
 * Loads admissions cases for whichever data plane is active.
 *
 * The fixture path exists so the surface can be reviewed without a Supabase
 * project. It reads the same legacy rows the other screens use in that mode and
 * maps them onto the shared shape, so the view is never a mock of itself.
 */
export async function loadAdmissionsCases(): Promise<
  readonly AdmissionsCaseInput[]
> {
  if (isUiContractFixtureMode()) {
    const [{ requireStaffRoute }, queries] = await Promise.all([
      import("@/lib/guards"),
      import("@/lib/queries"),
    ]);
    const user = await requireStaffRoute("/admissions");
    return queries.listClientsForActor(user).map((row) => ({
      studentCaseId: String(row.id),
      studentDisplayName: row.name,
      targetCountry: row.target_country ?? "Не указана",
      operationalStage: row.stage,
      state: row.case_state === "closed" ? "closed" : "active",
      currentCuratorDisplayName: row.curator_name ?? null,
      intake: null,
      overdueTaskCount: 0,
      overdueObligationCount: 0,
      rejectedDocumentCount: 0,
    }));
  }
  const actor = await requirePlatformAdmissionsActor();
  const { cases } = await listPlatformStudentCases(actor);
  return cases;
}

export const ADMISSIONS_STEP_LABELS = {
  documents: "Сбор документов",
  applications: "Подача",
  decisions: "Ожидание оффера",
  visa: "Виза",
  enrolled: "Зачисление",
} as const;
