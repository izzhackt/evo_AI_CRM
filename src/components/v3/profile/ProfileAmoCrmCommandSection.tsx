import { randomUUID } from "node:crypto";

import { CanonicalAmoCrmCommandPanel } from "@/components/platform/amocrm/CanonicalAmoCrmCommandPanel";
import type { FixedRole } from "@/lib/fixed-role-policy";
import { getT } from "@/lib/i18n";
import { readCanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import {
  PlatformAmoCrmCommandRpcError,
  readPlatformBlockingAmoCrmCommand,
} from "@/lib/server/platform-amocrm-command-rpc";
import type { PlatformStudentCaseHandoffContext } from "@/lib/platform-student-handoff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The sole V3 Admissions amoCRM command surface.
 *
 * Canonical case/person/lead identities come from the verified handoff
 * snapshot. Provider readiness and a persisted prepared/unknown attempt are
 * read from the Supabase command path only; there is no legacy writer or
 * fallback command repository.
 */
export async function ProfileAmoCrmCommandSection({
  organizationId,
  authorityRole,
  handoff,
}: Readonly<{
  organizationId: string;
  authorityRole: FixedRole;
  handoff: PlatformStudentCaseHandoffContext;
}>) {
  if (
    handoff.organizationId !== organizationId ||
    handoff.studentCaseId.length === 0 ||
    handoff.leadId.length === 0 ||
    handoff.clientContext.clientId.length === 0
  ) {
    throw new Error("V3 profile amoCRM context does not match the active organization.");
  }

  const { locale } = await getT();
  let availability: Awaited<
    ReturnType<typeof readCanonicalAmoCrmCommandAvailability>
  >;
  let blockingAttempt: Awaited<
    ReturnType<typeof readPlatformBlockingAmoCrmCommand>
  >;

  try {
    const staffClient = handoff.caseState === "active"
      ? await createSupabaseServerClient()
      : null;
    [availability, blockingAttempt] = await Promise.all([
      readCanonicalAmoCrmCommandAvailability(),
      handoff.caseState === "active"
        ? readPlatformBlockingAmoCrmCommand(staffClient!, {
            organizationId,
            authorization: {
              actorRole: authorityRole,
              workflowScope: "admissions_post_handoff",
              workflowLeadId: handoff.leadId,
              studentCaseId: handoff.studentCaseId,
            },
            personId: handoff.clientContext.clientId,
            leadId: handoff.leadId,
          })
        : Promise.resolve(null),
    ]);
  } catch (error: unknown) {
    if (error instanceof PlatformAmoCrmCommandRpcError) {
      return (
        <section
          className="v3-edge-danger rounded-card border border-border border-s-2 bg-surface px-4 py-4 text-sm text-fg"
          data-testid="v3-profile-amocrm-command-section"
          data-status="unavailable"
          role="status"
        >
          Команда amoCRM пока недоступна для этого Supabase-кейса. EVO не
          выполняет запись через старый или запасной путь.
        </section>
      );
    }
    throw error;
  }

  return (
    <section
      className="scroll-mt-24"
      data-testid="v3-profile-amocrm-command-section"
      data-status="available"
    >
      <CanonicalAmoCrmCommandPanel
        availability={availability}
        blockingAttempt={
          blockingAttempt === null
            ? null
            : {
                attemptId: blockingAttempt.attemptId,
                operationName: blockingAttempt.operationName,
                status: blockingAttempt.status as "prepared" | "unknown",
                providerDispatchedAt: blockingAttempt.providerDispatchedAt,
              }
        }
        scope="admissions"
        leadId={handoff.leadId}
        studentCaseId={handoff.studentCaseId}
        locale={locale}
        requestId={randomUUID()}
      />
    </section>
  );
}
