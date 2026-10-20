import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyStudentRecoveryRequestError,
  hasStaffRecoveryMarker,
  type StudentRecoveryRequestState,
} from "../student-password-recovery-contract.ts";

import { findRawAuthUserByExactEmail } from "./student-portal-invite-auth-provider.ts";

/**
 * Who the public «Забыли пароль?» form is asked about, decided before Auth is
 * called. Staff recovery stays admin-driven, and a student email must not
 * replace a staff recovery token or the timestamp the staff journal reads.
 *
 * - `staff`: the address belongs to a staff account. `basis` says how it was
 *   recognised: the provisioning marker in the Auth metadata, or a staff
 *   membership in the database (migration 313), which also catches a staff
 *   account that has no marker, such as the first system administrator.
 * - `other`: a Student, an applicant, or an address nobody uses. All three are
 *   handled alike, so the answer cannot tell them apart.
 * - `unavailable`: a lookup failed, so nobody can say. Nothing is sent. The
 *   `stage` tells the answer apart: the address lookup (asked for every
 *   address) or the membership question (asked only for an existing account).
 */
export type StudentRecoveryRecipient =
  | Readonly<{ status: "staff"; basis: "marker" | "membership" }>
  | Readonly<{ status: "other" }>
  | Readonly<{ status: "unavailable"; stage: "lookup" | "membership" }>;

/** The service-role calls, in the same shape as the other platform RPCs. */
type ServiceClient = Pick<SupabaseClient, "schema">;

/** `true` / `false`, or `null` when the database did not give a clear boolean. */
async function readStaffMembership(
  service: ServiceClient,
  authUserId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await service
      .schema("platform")
      .rpc("auth_user_has_staff_membership_v1", { p_auth_user_id: authUserId });
    if (error) return null;
    return typeof data === "boolean" ? data : null;
  } catch {
    return null;
  }
}

/**
 * One point lookup by exact address, then the cheap marker check, then the
 * membership question for the found user. An unknown address asks no second
 * question. Any failure is `unavailable` (fail closed), never `other`.
 */
export async function classifyStudentRecoveryRecipient(
  service: ServiceClient,
  normalizedEmail: string,
): Promise<StudentRecoveryRecipient> {
  const found = await findRawAuthUserByExactEmail(service, normalizedEmail);
  if (found.status === "unavailable") return { status: "unavailable", stage: "lookup" };
  if (found.status === "missing" || found.user === null) return { status: "other" };
  if (hasStaffRecoveryMarker(found.user, undefined)) {
    return { status: "staff", basis: "marker" };
  }
  // findRawAuthUserByExactEmail already checked that the id is a UUID.
  const member = await readStaffMembership(service, String(found.user.id));
  if (member === null) return { status: "unavailable", stage: "membership" };
  return member ? { status: "staff", basis: "membership" } : { status: "other" };
}

/**
 * The effects of one request, injected so that the decision itself runs the
 * same code in production and in tests.
 */
export type StudentRecoveryRequestPorts = Readonly<{
  /** Never throws: a failure is an `unavailable` answer. */
  recipient: (normalizedEmail: string) => Promise<StudentRecoveryRecipient>;
  /** `resetPasswordForEmail`: the Auth error (or null); rejects on a transport failure. */
  sendEmail: (normalizedEmail: string, redirectTo: string) => Promise<Readonly<{ error: unknown }>>;
  /** PII-free structured log line: the stage, and the error for its code only. */
  log: (stage: string, error?: unknown) => void;
}>;

/**
 * Asks Auth to email a recovery link, unless the address belongs to staff.
 *
 * Staff get the same neutral «sent» as everyone else and no email, no Auth
 * call: the caller holds every answer to one fixed deadline
 * (`answerAtFixedDeadline`), so the missing Auth call is not visible in time.
 * `redirectTo` is built by the caller from the fixed Student origin.
 */
export async function runStudentRecoveryRequest(
  ports: StudentRecoveryRequestPorts,
  email: string,
  redirectTo: string,
): Promise<StudentRecoveryRequestState["status"]> {
  let recipient: StudentRecoveryRecipient;
  try {
    recipient = await ports.recipient(email);
  } catch (error) {
    ports.log("request_lookup", error);
    return "unavailable";
  }
  if (recipient.status === "unavailable") {
    ports.log(recipient.stage === "lookup" ? "request_lookup" : "request_membership");
    // The address lookup runs for every address alike, so its failure says
    // nothing about an account. The membership question is asked only about
    // an account that exists, so a failure there stays the neutral «sent»,
    // as an Auth send failure does (see classifyStudentRecoveryRequestError).
    // Nothing is sent either way.
    return recipient.stage === "lookup" ? "unavailable" : "sent";
  }
  if (recipient.status === "staff") {
    ports.log(recipient.basis === "marker" ? "request_staff_skipped" : "request_staff_skipped_membership");
    return "sent";
  }
  try {
    const { error } = await ports.sendEmail(email, redirectTo);
    if (error) ports.log("request", error);
    return classifyStudentRecoveryRequestError(error);
  } catch (error) {
    ports.log("request", error);
    return "unavailable";
  }
}
