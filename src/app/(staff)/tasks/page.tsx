import { randomUUID } from "node:crypto";
import type { Metadata } from "next";

import {
  PlatformAdmissionsTaskPanel,
  type PlatformAdmissionsTaskFeedback,
  type PlatformAdmissionsTaskRequestIds,
} from "@/components/platform/admissions/PlatformAdmissionsTaskPanel";
import { getT } from "@/lib/i18n";
import { listPlatformAdmissionsTaskQueue } from "@/lib/platform-admissions-workspace";
import { requirePlatformCapability } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";

type SearchParams = Readonly<{
  task_result?: string | string[];
  task_retry_request_id?: string | string[];
  task_retry_operation?: string | string[];
  task_subject_id?: string | string[];
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COPY = {
  ru: {
    title: "Задачи команды",
    description:
      "Единая очередь задач Admissions из Supabase. Изменения открываются только в рамках доступного переданного кейса.",
  },
  ky: {
    title: "Команданын тапшырмалары",
    description:
      "Supabase ичиндеги Admissions тапшырмаларынын бирдиктүү кезеги. Өзгөртүүлөр жеткиликтүү өткөрүлгөн кейстин ичинде гана ачылат.",
  },
  en: {
    title: "Team tasks",
    description:
      "One Supabase Admissions task queue. Changes are available only within an accessible handed-off case.",
  },
} as const;

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function feedbackFrom(
  params: SearchParams,
): PlatformAdmissionsTaskFeedback | undefined {
  const outcome = single(params.task_result);
  if (outcome !== "saved" && outcome !== "invalid" && outcome !== "unavailable") {
    return undefined;
  }
  const operation = single(params.task_retry_operation);
  const subjectId = single(params.task_subject_id);
  return {
    outcome,
    operation:
      operation === "create" || operation === "change" ? operation : null,
    subjectId:
      subjectId && UUID_PATTERN.test(subjectId)
        ? subjectId.toLowerCase()
        : null,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

export default async function TasksPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/tasks"),
    searchParams,
  ]);
  const tasksPage = await listPlatformAdmissionsTaskQueue(actor, {
    pageSize: 50,
  });
  const retryRequestId = single(params.task_retry_request_id);
  const retrySubjectId = single(params.task_subject_id);
  const retryChange =
    single(params.task_retry_operation) === "change" &&
    retryRequestId !== null &&
    UUID_PATTERN.test(retryRequestId) &&
    retrySubjectId !== null &&
    UUID_PATTERN.test(retrySubjectId);
  const requestIds: PlatformAdmissionsTaskRequestIds = {
    create: randomUUID(),
    changes: Object.fromEntries(
      tasksPage.rows.map((task) => [
        task.caseTaskId,
        retryChange && retrySubjectId.toLowerCase() === task.caseTaskId
          ? retryRequestId.toLowerCase()
          : randomUUID(),
      ]),
    ),
  };
  const copy = COPY[locale];

  return (
    <div className="space-y-5" data-testid="platform-admissions-task-queue">
      <header className="border-b border-border pb-5">
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg">
          {copy.title}
        </h1>
        <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
      </header>
      <PlatformAdmissionsTaskPanel
        locale={locale}
        tasks={tasksPage.rows}
        actorMembershipId={actor.membershipId}
        authorityRole={actor.authorityRole}
        presentationRole={actor.presentationRole}
        requestIds={requestIds}
        showCase
        hasNext={tasksPage.hasNext}
        feedback={feedbackFrom(params)}
      />
    </div>
  );
}
