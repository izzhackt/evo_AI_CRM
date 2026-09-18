import Link from "next/link";
import { redirect } from "next/navigation";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { ApplicationStatus } from "@/components/student-application/ApplicationStatus";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readOwnStudentApplication } from "@/lib/v3/student-application-source";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Моя заявка | EVO Admissions" }, robots: { index: false, follow: false } };

export default async function ApplicationStatusPage() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at) redirect("/login");
  const application = await readOwnStudentApplication(client);
  if (!application) redirect("/apply");
  return <main className="min-h-dvh bg-bg px-5 pb-12 text-fg sm:px-8">
    <header className="mx-auto flex max-w-4xl items-center py-7"><Link href="/apply/status"><EvoLogo width={146} /></Link></header>
    <div className="mx-auto max-w-4xl rounded-card border border-border bg-surface px-5 py-8 sm:p-10"><ApplicationStatus application={application} draftOwnerId={data.user.id} /></div>
  </main>;
}
