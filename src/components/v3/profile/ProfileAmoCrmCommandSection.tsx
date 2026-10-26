import { randomUUID } from "node:crypto";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";

import { Icon } from "@/components/icons";
import { CanonicalAmoCrmCommandPanel } from "@/components/platform/amocrm/CanonicalAmoCrmCommandPanel";
import { getT } from "@/lib/i18n";
import { readCanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import {
  PlatformAmoCrmCommandRpcError,
  readPlatformBlockingAmoCrmCommand,
} from "@/lib/server/platform-amocrm-command-rpc";
import type { PlatformStudentCaseHandoffContext } from "@/lib/platform-student-handoff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Сбой чтения не доказывает, что попытки нет: подготовленная или неизвестная могла остаться. Поэтому текст
 * говорит только о том, что верно всегда, — эта страница ничего не отправляла, — и не обещает «ничего не записано».
 */
const AMOCRM_UNAVAILABLE = {
  ru: "Не удалось проверить состояние amoCRM. С этой страницы ничего не отправлено. Сообщите администратору.",
  ky: "amoCRM абалын текшерүү мүмкүн болгон жок. Бул беттен эч нерсе жөнөтүлгөн жок. Администраторго кабарлаңыз.",
  en: "Could not check the amoCRM state. Nothing was sent from this page. Tell your administrator.",
} as const;

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
  actor,
  handoff,
}: Readonly<{
  organizationId: string;
  actor: import("@/lib/platform-auth").ActivePlatformActor;
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
              // Compatibility descriptor of the operation view; SQL checks
              // live paired case authority independently.
              actorRole: actor.systemRole === "admin" ? "admin" : "admissions",
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
          className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-4 text-sm text-fg"
          data-testid="v3-profile-amocrm-command-section"
          data-status="unavailable"
          role="status"
        >
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-danger" />
          <p>{AMOCRM_UNAVAILABLE[locale]}</p>
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
        canMutate={!isStaffPreview(actor) && staffHasPermission(actor, "amocrm.command.manage")}
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
