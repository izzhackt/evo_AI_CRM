import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ApplicationWizard } from "@/components/student-application/ApplicationWizard";
import { STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft } from "@/lib/student-application-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readOwnStudentApplication } from "@/lib/v3/student-application-source";
import { studentApplicationEntryRedirect } from "@/lib/server/student-signup-runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Начните поступление | EVO Admissions" }, description: "Расскажите о ваших планах и создайте личный аккаунт EVO." };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError") throw new Error("Student registration is unavailable.");
  let draft = null;
  let email = null;
  let revision = 0;
  if (data.user?.email_confirmed_at) {
    const destination = await studentApplicationEntryRedirect(client, data.user);
    if (destination) redirect(destination);
    const application = await readOwnStudentApplication(client);
    if (application && (application.status !== "rejected" || query.edit !== "1")) redirect("/apply/status");
    email = data.user.email ?? null;
    draft = application?.questionnaire ?? validateStudentApplicationDraft(data.user.user_metadata?.[STUDENT_APPLICATION_METADATA_KEY]);
    revision = application?.revision ?? 0;
  }
  return <ApplicationWizard requestId={randomUUID()} draft={draft} signedInEmail={email} draftOwnerId={email ? data.user?.id : null} expectedRevision={revision} year={new Date().getUTCFullYear()} />;
}
