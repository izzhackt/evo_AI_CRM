import "server-only";

import type { ActivePlatformActor } from "../platform-auth";
import { parseRequestsQueue, type RequestSelection, type RequestsQueue } from "../requests-queue-contract";
import { createSupabaseServerClient } from "../supabase/server";
import { parsePortalConsultationRow } from "./requests-source";
import { decodeStudentApplication } from "./student-application-source";

export class RequestsQueueSourceError extends Error {
  constructor(public readonly code: "forbidden" | "invalid" | "unavailable") {
    super("Requests queue unavailable.");
    this.name = "RequestsQueueSourceError";
  }
}

export async function loadScopedRequestsQueue(actor: ActivePlatformActor, selection: RequestSelection): Promise<RequestsQueue> {
  const client = await createSupabaseServerClient();
  // POST: no nullable timestamp/cursor strings in PostgREST's GET query.
  const { data, error } = await client.schema("platform").rpc("staff_requests_queue_v1", {
    p_organization_id: actor.organizationId,
    p_source: selection.source,
    p_application_status: selection.applicationStatus,
    p_consultation_status: selection.consultationStatus,
    p_limit: selection.limit,
    ...(selection.cursor ? { p_cursor: selection.cursor } : {}),
  });
  if (error) throw new RequestsQueueSourceError(error.code === "42501" ? "forbidden" : error.code === "22023" ? "invalid" : "unavailable");
  return parseRequestsQueue(data, actor.organizationId, selection, decodeStudentApplication, parsePortalConsultationRow);
}
