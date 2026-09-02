import { randomUUID } from "node:crypto";

import { CanonicalAmoCrmCommandPanel } from "@/components/platform/amocrm/CanonicalAmoCrmCommandPanel";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import { readCanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import {
  PlatformAmoCrmCommandRpcError,
  readPlatformBlockingAmoCrmCommand,
} from "@/lib/server/platform-amocrm-command-rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Canonical Student 360 amoCRM command section.
 *
 * The canonical Supabase Student context supplies the identifiers. This
 * section reads the active Supabase command/blocking path only; it must not
 * become another Student summary, handoff or contract path.
 */
export async function CanonicalAmoCrmCommandSection({
  organizationId,
  authorityRole,
  locale,
  studentCaseId,
  leadId,
  clientId,
  caseState,
}: Readonly<{
  organizationId: string;
  authorityRole: FixedRole;
  locale: Locale;
  studentCaseId: string;
  leadId: string;
  clientId: string;
  caseState: "pending" | "active" | "closed";
}>) {
  let availability: Awaited<
    ReturnType<typeof readCanonicalAmoCrmCommandAvailability>
  >;
  let blockingAttempt: Awaited<
    ReturnType<typeof readPlatformBlockingAmoCrmCommand>
  >;
  try {
    const staffClient = caseState === "active" ? await createSupabaseServerClient() : null;
    [availability, blockingAttempt] = await Promise.all([
      readCanonicalAmoCrmCommandAvailability(),
      caseState === "active"
        ? readPlatformBlockingAmoCrmCommand(staffClient!, {
            organizationId,
            authorization: {
              actorRole: authorityRole,
              workflowScope: "admissions_post_handoff",
              workflowLeadId: leadId,
              studentCaseId,
            },
            personId: clientId,
            leadId,
          })
        : Promise.resolve(null),
    ]);
  } catch (error: unknown) {
    if (error instanceof PlatformAmoCrmCommandRpcError) {
      return (
        <section
          id="case-amocrm"
          className="scroll-mt-24 border-y border-warn/30 bg-warn-weak px-4 py-4 text-sm text-warn"
          data-testid="amocrm-case-command-section"
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
    <div
      id="case-amocrm"
      className="scroll-mt-24"
      data-testid="amocrm-case-command-section"
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
        leadId={leadId}
        studentCaseId={studentCaseId}
        locale={locale}
        requestId={randomUUID()}
      />
    </div>
  );
}
