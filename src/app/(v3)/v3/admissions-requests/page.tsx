import { randomUUID } from "node:crypto";
import { PartShell } from "@/components/v3/PartShell";
import { StudentApplications, StudentApplicationsNav } from "@/components/v3/admissions/StudentApplications";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { loadStudentApplicationQueue } from "@/lib/v3/student-application-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "EVO · Заявки студентов" };

export default async function StudentApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireV3PageActor("/v3/admissions-requests");
  const params = await searchParams;
  const selectedId = typeof params.application === "string" ? params.application : null;
  let queue;
  try {
    queue = await loadStudentApplicationQueue();
  } catch {
    return <PartShell title="Заявки студентов"><div className="space-y-6">
      <StudentApplicationsNav current="applications" pendingCount={null} />
      <div role="alert" className="space-y-2 text-sm text-fg-2">
        <p>Не удалось загрузить заявки. Проверьте доступ и повторите попытку.</p>
        <a href="/v3/admissions-requests" className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline">Повторить</a>
      </div>
    </div></PartShell>;
  }
  return <PartShell title="Заявки студентов"><div className="space-y-6">
    <StudentApplicationsNav current="applications" pendingCount={queue.pendingCount} />
    <StudentApplications queue={queue} selectedId={selectedId} requestId={randomUUID()} readOnly={isStaffPreview(actor)} />
  </div></PartShell>;
}
