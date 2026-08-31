import type { Metadata } from "next";
import { randomUUID } from "node:crypto";

import {
  CanonicalAdmissionsTaskPanel,
  type CanonicalAdmissionsTaskRequestIds,
} from "@/components/platform/admissions/CanonicalAdmissionsTaskPanel";
import { getT } from "@/lib/i18n";
import { requirePlatformCapability } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { listCanonicalAdmissionsTasks } from "@/lib/server/canonical-crm-repository";

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "Задачи команды",
    ky: "Команданын тапшырмалары",
    en: "Team tasks",
  });
}

export default async function TasksPage() {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/tasks"),
  ]);
  const tasksPage = await listCanonicalAdmissionsTasks({
    actorRole: actor.platformRole,
    pageSize: 50,
  });
  const transitionRequestIds: CanonicalAdmissionsTaskRequestIds =
    Object.fromEntries(
      tasksPage.rows.map((task) => [
        task.taskId,
        Object.freeze({ complete: randomUUID(), cancel: randomUUID() }),
      ]),
    );

  return (
    <div data-testid="canonical-admissions-task-queue">
      <CanonicalAdmissionsTaskPanel
        locale={locale}
        tasks={tasksPage.rows}
        transitionRequestIds={transitionRequestIds}
        showCase
        hasNext={tasksPage.hasNext}
      />
    </div>
  );
}
