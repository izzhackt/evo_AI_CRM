"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  ROLE_HOME_ROUTE,
  roleCanAccessStaffRoute,
  type DocumentStatus,
} from "@/lib/domain";

type DocumentRecord = {
  id: number;
  client_id: number;
  status: string;
  comment: string | null;
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
    .prepare("SELECT id, client_id, status, comment FROM documents WHERE id = ?")
    .get(id) as DocumentRecord | undefined;
  if (!row) redirect("/documents");

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
