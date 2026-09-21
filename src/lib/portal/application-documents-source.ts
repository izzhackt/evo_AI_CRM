import "server-only";
import { requireStudentPortalActor } from "../student-portal-guards";
import { requirePlatformStaffActor } from "../platform-guards";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { createSupabaseServerClient } from "../supabase/server";
import { ApplicationDocumentError, applicationDocumentFailure, parseApplicationDocuments, parseApplicationDocumentTarget, type ApplicationDocuments, parseApplicationDocumentNotification, type ApplicationDocumentNotification } from "./application-documents.ts";

async function read(studentCaseId: string, applicationId: string, kind: "student" | "staff"): Promise<ApplicationDocuments> {
  const target = parseApplicationDocumentTarget({ studentCaseId, applicationId });
  if (!target) throw new ApplicationDocumentError("invalid");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(`${kind}_application_documents_v1`, { p_student_case_id: studentCaseId, p_application_id: applicationId });
  if (error) throw new ApplicationDocumentError(applicationDocumentFailure(error).reason);
  const documents = parseApplicationDocuments(data, target);
  if (!documents) throw new ApplicationDocumentError("unavailable");
  return documents;
}
export async function readStudentApplicationDocuments(studentCaseId: string, applicationId: string): Promise<ApplicationDocuments> {
  const actor = await requireStudentPortalActor();
  if (actor.studentCaseId !== studentCaseId) throw new ApplicationDocumentError("forbidden");
  return read(studentCaseId, applicationId, "student");
}
export async function readStaffApplicationDocuments(studentCaseId: string, applicationId: string): Promise<ApplicationDocuments> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "document.read.full")) throw new ApplicationDocumentError("forbidden");
  return read(studentCaseId, applicationId, "staff");
}

export async function readStudentApplicationDocumentNotification(notificationId: string): Promise<ApplicationDocumentNotification> {
  const actor = await requireStudentPortalActor();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(notificationId)) throw new ApplicationDocumentError("invalid");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("student_application_document_notification_v1", { p_notification_id: notificationId });
  if (error) throw new ApplicationDocumentError(applicationDocumentFailure(error).reason);
  const notification = parseApplicationDocumentNotification(data, notificationId, actor.studentCaseId);
  if (!notification) throw new ApplicationDocumentError("unavailable");
  return notification;
}
