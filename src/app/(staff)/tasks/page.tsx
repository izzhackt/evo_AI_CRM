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

const COPY = {
  ru: {
    title: "Задачи команды",
    description:
      "Общая операционная очередь задач Admissions по всем переданным кейсам.",
  },
  ky: {
    title: "Команданын тапшырмалары",
    description:
      "Бардык өткөрүлгөн кейстер боюнча Admissions тапшырмаларынын жалпы кезеги.",
  },
  en: {
    title: "Team tasks",
    description:
      "Shared Admissions operational task queue across every handed-off case.",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
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

  const copy = COPY[locale];

  return (
    <div className="space-y-5" data-testid="canonical-admissions-task-queue">
      <header className="border-b border-border pb-5">
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg">
          {copy.title}
        </h1>
        <p className="mt-2 max-w-[60ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
      </header>
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
