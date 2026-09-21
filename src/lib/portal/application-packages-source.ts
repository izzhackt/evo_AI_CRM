import "server-only";
import { requireStudentPortalActor } from "../student-portal-guards";
import { requirePlatformStaffActor } from "../platform-guards";
import { ApplicationPackageError } from "./application-packages.ts";
import {
  readStudentApplicationPackageReadinessAction,
  readStaffApplicationPackageReadinessAction,
  readStudentApplicationPackageNotificationAction,
} from "./application-packages-actions";

/** Initial server reads use the same scoped, strictly decoded ordinary RPC path as refreshes. */
export async function readStudentApplicationPackageReadiness(studentCaseId: string, applicationId: string, selections: unknown = []) {
  const actor = await requireStudentPortalActor();
  const result = await readStudentApplicationPackageReadinessAction({
    organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId, applicationId,
  }, { studentCaseId, applicationId }, selections);
  if (!result.ok) throw new ApplicationPackageError(result.reason);
  return result.readiness;
}
export async function readStaffApplicationPackageReadiness(studentCaseId: string, applicationId: string, selections: unknown = []) {
  const actor = await requirePlatformStaffActor();
  const result = await readStaffApplicationPackageReadinessAction({
    organizationId: actor.organizationId, membershipId: actor.membershipId,
  }, { studentCaseId, applicationId }, selections);
  if (!result.ok) throw new ApplicationPackageError(result.reason);
  return result.readiness;
}
export async function readStudentApplicationPackageNotification(notificationId: string) {
  const actor = await requireStudentPortalActor();
  const result = await readStudentApplicationPackageNotificationAction({
    organizationId: actor.organizationId, membershipId: actor.membershipId,
  }, notificationId);
  if (!result.ok) throw new ApplicationPackageError(result.reason);
  return result.notification;
}
