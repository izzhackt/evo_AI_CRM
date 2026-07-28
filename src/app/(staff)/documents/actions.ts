"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  canClientCapability,
  resolveClientAccess,
  type ClientAccessSubject,
} from "@/lib/access";
import { db } from "@/lib/db";
import {
  ROLE_HOME_ROUTE,
  roleCanAccessStaffRoute,
  type DocumentStatus,
} from "@/lib/domain";
import { isStudentCaseState } from "@/lib/student-case-policy";

type DocumentRecord = {
  id: number;
  client_id: number;
  status: string;
  comment: string | null;
  manager_id: number | null;
  curator_id: number | null;
  case_state: string;
  handoff_at: string | null;
};

const ALLOWED_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  required: [],
  uploaded: ["review"],
  review: ["approved", "required", "rejected"],
  approved: ["review"],
  rejected: [],
};

function documentLocation(id: number, query: string): string {
  return `/documents/${id}?${query}`;
}

function revalidateDocumentSurfaces(id: number, clientId: number) {
  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/portal");
}

export async function reviewDocumentAction(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!roleCanAccessStaffRoute(user.role, "/documents")) {
    redirect(ROLE_HOME_ROUTE[user.role]);
  }

  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) redirect("/documents");

  const nextStatus = String(form.get("status") ?? "") as DocumentStatus;
  const row = db()
    .prepare(`
      SELECT d.id, d.client_id, d.status, d.comment,
             c.manager_id, c.curator_id, c.case_state, c.handoff_at
      FROM documents d
      JOIN clients c ON c.id = d.client_id
      WHERE d.id = ?
    `)
    .get(id) as DocumentRecord | undefined;
  if (!row || !isStudentCaseState(row.case_state)) {
    notFound();
  }

  const subject: ClientAccessSubject = {
    id: row.client_id,
    manager_id: row.manager_id,
    curator_id: row.curator_id,
    case_state: row.case_state,
    handoff_at: row.handoff_at,
  };
  if (!canClientCapability(resolveClientAccess(user, subject), "write_documents")) {
    notFound();
  }

  const currentStatus = row.status as DocumentStatus;
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed?.includes(nextStatus)) {
    redirect(documentLocation(id, "error=invalid_transition"));
  }

  const comment = String(form.get("comment") ?? "").trim();
  const needsReason =
    nextStatus === "required" ||
    nextStatus === "rejected" ||
    (currentStatus === "approved" && nextStatus === "review");

  if (needsReason && comment.length === 0) {
    redirect(documentLocation(id, "error=comment_required"));
  }
  if (comment.length > 1000) {
    redirect(documentLocation(id, "error=comment_too_long"));
  }

  const nextComment =
    nextStatus === "approved"
      ? null
      : comment || row.comment;

  const result = db()
    .prepare(
      "UPDATE documents SET status = ?, comment = ?, updated_at = datetime('now') WHERE id = ? AND status = ?",
    )
    .run(nextStatus, nextComment, id, currentStatus);
  if (result.changes !== 1) {
    redirect(documentLocation(id, "error=invalid_transition"));
  }

  revalidateDocumentSurfaces(id, row.client_id);
  redirect(documentLocation(id, `updated=${nextStatus}`));
}
