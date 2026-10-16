"use server";

import { createHash } from "node:crypto";

import { readStudentCatalogPreparationsFor } from "./portal/catalog-preparations-source";
import { requireStudentPortalActor } from "./student-portal-guards";
import {
  readStudentPortalDocuments,
  readStudentPortalNotifications,
  readStudentPortalOverview,
  readStudentPortalPayments,
} from "./v3/portal-source";

/**
 * Разделы, которые обновляются сами, когда что-то изменилось (план A,
 * 16.10.2026). Раньше вкладка каждые 30 с перерисовывала их целиком
 * (`router.refresh()`), даже если ничего не менялось. Теперь опрос читает
 * тот же источник, что и раздел, и отдаёт только число непрочитанных и
 * подпись. Страница перечитывается, только если подпись изменилась.
 */
export type StudentPortalUpdateSection = "home" | "admission" | "documents" | "payments" | "notifications";
const SECTIONS: readonly StudentPortalUpdateSection[] = ["home", "admission", "documents", "payments", "notifications"];

function signature(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 32);
}

async function sectionContent(section: StudentPortalUpdateSection | null, actor: Promise<Awaited<ReturnType<typeof requireStudentPortalActor>>>) {
  switch (section) {
    case "home":
      return (await actor).accessTier === "assisted" ? readStudentPortalOverview() : null;
    case "admission": {
      const [overview, preparations] = await Promise.all([
        readStudentPortalOverview(),
        actor.then((current) => readStudentCatalogPreparationsFor(current)),
      ]);
      return { overview, preparations };
    }
    case "documents":
      return readStudentPortalDocuments();
    case "payments":
      return readStudentPortalPayments();
    default:
      return null;
  }
}

export async function loadStudentPortalNotificationState(section: unknown = null) {
  try {
    const target = SECTIONS.find((value) => value === section) ?? null;
    // Проверка доступа и чтения идут одновременно: каждое RPC само проверяет
    // живого студента, а ответ возвращается только после проверки.
    const actorRead = requireStudentPortalActor();
    const [actor, notifications, content] = await Promise.all([
      actorRead,
      readStudentPortalNotifications(),
      sectionContent(target, actorRead),
    ]);
    return {
      ok: true as const,
      unread: notifications.filter(item => item.readAt === null).length,
      signature: signature({
        tier: actor.accessTier,
        state: actor.caseState,
        notifications: notifications.map((item) => [item.notificationId, item.readAt]),
        content,
      }),
    };
  } catch {
    return { ok: false as const };
  }
}
