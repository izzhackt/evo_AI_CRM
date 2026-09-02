import { randomUUID } from "node:crypto";

import {
  CanonicalAdmissionsOperationsPanel,
  type CanonicalAdmissionsOperationsRequestIds,
} from "@/components/platform/admissions/CanonicalAdmissionsOperationsPanel";
import {
  CanonicalAdmissionsTaskPanel,
  type CanonicalAdmissionsTaskRequestIds,
} from "@/components/platform/admissions/CanonicalAdmissionsTaskPanel";
import { CanonicalPrivateDocumentsPanel } from "@/components/platform/documents/CanonicalPrivateDocumentsPanel";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  CanonicalCrmRepositoryError,
  getCanonicalAdmissionsOperationsSnapshot,
  listCanonicalAdmissionsTasks,
} from "@/lib/server/canonical-crm-repository";
import {
  listPrivateDocumentsForCase,
  PrivateDocumentRepositoryError,
} from "@/lib/server/private-document-repository";

/**
 * Temporary #548 isolation boundary.
 *
 * This component is the only route-local owner of the superseded Admissions
 * task, application/visa/finance and private-document reads. It must not grow
 * a second Student summary, handoff, profile or contract path.
 */
export async function AdmissionsCaseOperationsSection({
  studentCaseId,
  authorityRole,
  presentationRole,
  locale,
}: Readonly<{
  studentCaseId: string;
  authorityRole: FixedRole;
  presentationRole: FixedRole;
  locale: Locale;
}>) {
  let tasksPage: Awaited<ReturnType<typeof listCanonicalAdmissionsTasks>>;
  let operations: Awaited<
    ReturnType<typeof getCanonicalAdmissionsOperationsSnapshot>
  >;
  let documents: Awaited<ReturnType<typeof listPrivateDocumentsForCase>>;

  try {
    [tasksPage, operations, documents] = await Promise.all([
      listCanonicalAdmissionsTasks({
        actorRole: authorityRole,
        studentCaseId,
        pageSize: 50,
      }),
      getCanonicalAdmissionsOperationsSnapshot({
        actorRole: authorityRole,
        studentCaseId,
      }),
      listPrivateDocumentsForCase({
        actorRole: authorityRole,
        caseId: studentCaseId,
      }),
    ]);
  } catch (error: unknown) {
    if (
      (error instanceof CanonicalCrmRepositoryError &&
        (error.code === "not_found" || error.code === "unavailable")) ||
      (error instanceof PrivateDocumentRepositoryError &&
        (error.code === "not_found" || error.code === "unavailable"))
    ) {
      return (
        <section
          data-testid="admissions-case-operations-section"
          data-status="unavailable"
          className="border-y border-warn/30 bg-warn-weak px-4 py-4 text-sm text-warn"
          aria-label="Admissions case operations"
          role="status"
        >
          <span id="case-tasks" className="block scroll-mt-24" />
          <span id="case-documents" className="block scroll-mt-24" />
          <span id="case-operations" className="block scroll-mt-24" />
          <span id="applications" className="block scroll-mt-24" />
          <span id="visa" className="block scroll-mt-24" />
          <span id="finance" className="block scroll-mt-24" />
          <p className="max-w-[56ch]">
            Задачи, документы, заявки, виза и финансовый стоп пока недоступны
            в этом Supabase-кейсе. EVO не использует запасной источник данных.
          </p>
        </section>
      );
    }
    throw error;
  }

  const transitionRequestIds: CanonicalAdmissionsTaskRequestIds =
    Object.fromEntries(
      tasksPage.rows.map((task) => [
        task.taskId,
        Object.freeze({ complete: randomUUID(), cancel: randomUUID() }),
      ]),
    );
  const operationRequestIds: CanonicalAdmissionsOperationsRequestIds = {
    createApplication: randomUUID(),
    applications: Object.fromEntries(
      operations.applications.map((application) => [
        application.applicationId,
        Object.freeze({
          update: randomUUID(),
          submitted: randomUUID(),
          accepted: randomUUID(),
          rejected: randomUUID(),
          withdrawn: randomUUID(),
        }),
      ]),
    ),
    visaMilestones: Object.fromEntries(
      operations.visaMilestones.map((milestone) => [
        milestone.visaMilestoneId,
        Object.freeze({
          in_progress: randomUUID(),
          completed: randomUUID(),
          blocked: randomUUID(),
        }),
      ]),
    ),
    finance: Object.freeze({ assert: randomUUID(), release: randomUUID() }),
  };

  return (
    <section
      data-testid="admissions-case-operations-section"
      data-status="available"
      className="space-y-6"
      aria-label="Admissions case operations"
    >
      <div id="case-tasks" className="scroll-mt-24">
        <CanonicalAdmissionsTaskPanel
          locale={locale}
          tasks={tasksPage.rows}
          transitionRequestIds={transitionRequestIds}
          create={
            operations.studentCase.status === "active"
              ? { studentCaseId, requestId: randomUUID() }
              : undefined
          }
          hasNext={tasksPage.hasNext}
        />
      </div>

      <div id="case-documents" className="scroll-mt-24">
        <CanonicalPrivateDocumentsPanel
          locale={locale}
          caseId={studentCaseId}
          caseStatus={operations.studentCase.status}
          documents={documents}
        />
      </div>

      <div id="case-operations" className="scroll-mt-24">
        <CanonicalAdmissionsOperationsPanel
          locale={locale}
          actorRole={presentationRole}
          studentCaseId={studentCaseId}
          studentCaseStatus={operations.studentCase.status}
          applications={operations.applications}
          visaMilestones={operations.visaMilestones}
          financeStop={operations.financeStop}
          requestIds={operationRequestIds}
        />
      </div>
    </section>
  );
}
