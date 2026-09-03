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
 * Canonical Sales pre-handoff amoCRM command section.
 *
 * The Sales lead and linked client come from the active Supabase Platform
 * projection. This section deliberately has no legacy repository, provider
 * secondary provider path or alternate command surface.
 */
export async function PlatformSalesAmoCrmCommandSection({
  organizationId,
  authorityRole,
  locale,
  leadId,
  clientId,
}: Readonly<{
  organizationId: string;
  authorityRole: FixedRole;
  locale: Locale;
  leadId: string;
  clientId: string | null;
}>) {
  if (clientId === null) {
    return (
      <section
        id="sales-amocrm"
        className="scroll-mt-24 border-y border-warn/30 bg-warn-weak px-4 py-4 text-sm text-warn"
        data-testid="sales-amocrm-command-section"
        data-status="missing-client"
        role="status"
      >
        Команда amoCRM недоступна: у лида нет связанного клиента. EVO не
        выполняет запись через старый или запасной путь.
      </section>
    );
  }

  let availability: Awaited<
    ReturnType<typeof readCanonicalAmoCrmCommandAvailability>
  >;
  let blockingAttempt: Awaited<
    ReturnType<typeof readPlatformBlockingAmoCrmCommand>
  >;

  try {
    const staffClient = await createSupabaseServerClient();
    [availability, blockingAttempt] = await Promise.all([
      readCanonicalAmoCrmCommandAvailability(),
      readPlatformBlockingAmoCrmCommand(staffClient, {
        organizationId,
        authorization: {
          actorRole: authorityRole,
          workflowScope: "sales_pre_handoff",
          workflowLeadId: leadId,
          studentCaseId: null,
        },
        personId: clientId,
        leadId,
      }),
    ]);
  } catch (error: unknown) {
    if (error instanceof PlatformAmoCrmCommandRpcError) {
      return (
        <section
          id="sales-amocrm"
          className="scroll-mt-24 border-y border-warn/30 bg-warn-weak px-4 py-4 text-sm text-warn"
          data-testid="sales-amocrm-command-section"
          data-status="unavailable"
          role="status"
        >
          Команда amoCRM пока недоступна для этого Supabase-лида. EVO не
          выполняет запись через старый или запасной путь.
        </section>
      );
    }
    throw error;
  }

  return (
    <div
      id="sales-amocrm"
      className="scroll-mt-24"
      data-testid="sales-amocrm-command-section"
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
        scope="sales"
        leadId={leadId}
        locale={locale}
        requestId={randomUUID()}
      />
    </div>
  );
}
