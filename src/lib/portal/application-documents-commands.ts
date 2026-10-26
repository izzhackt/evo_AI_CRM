import {
  clearApplicationDocumentPending, persistApplicationDocumentPending, readApplicationDocumentPending, withApplicationDocumentLock,
  type ApplicationDocumentPendingEnvironment,
} from "./application-documents-pending.ts";
import { freezeApplicationDocumentUploadIntent, uploadApplicationDocumentFile } from "./application-documents-upload.ts";
import type {
  ApplicationDocumentFailure, ApplicationDocumentItemTarget, ApplicationDocumentScope, ApplicationDocumentSelection,
  ApplicationDocumentSubmitIntent, ApplicationDocumentSubmitResult, ApplicationDocumentUploadIntent,
  ApplicationDocumentUploadReceipt, ApplicationDocumentUploadResult,
} from "./application-documents.ts";

/**
 * Program-document commands shared by the separate «Сохранить файл» /
 * «Отправить на проверку» controls and by the student's one-tap path. Every
 * command takes its own lock, persists its intent BEFORE the network call and
 * clears it only after a confirmed receipt or a certified no-write result, so
 * a crash at any point leaves either a saved draft or a retained intent that
 * the existing recovery resolves. The upload and submit locks are taken one
 * after the other, never nested.
 */
export type ApplicationDocumentAudience = "student" | "staff";
export type ApplicationDocumentUploadFn = (input: Readonly<{
  audience: ApplicationDocumentAudience; intent: ApplicationDocumentUploadIntent; file: File;
}>) => Promise<ApplicationDocumentUploadResult>;
export type ApplicationDocumentSubmitFn = (scope: ApplicationDocumentScope, intent: ApplicationDocumentSubmitIntent) => Promise<ApplicationDocumentSubmitResult>;
type Resolution = "retain" | "not_written";

export type ApplicationDocumentUploadOutcome =
  | Readonly<{ status: "uploaded"; receipt: ApplicationDocumentUploadReceipt; cleared: boolean }>
  | Readonly<{ status: "invalid_file" }>
  | Readonly<{ status: "wrong_file" }>
  | Readonly<{ status: "rejected"; reason: ApplicationDocumentFailure; resolution: Resolution }>
  | Readonly<{ status: "locked"; reason: "busy" | "storage_unavailable" }>;

function sameUpload(a: ApplicationDocumentUploadIntent, b: ApplicationDocumentUploadIntent) {
  return a.requestId === b.requestId && a.studentCaseId === b.studentCaseId
    && a.applicationId === b.applicationId && a.requirementsRevisionId === b.requirementsRevisionId
    && a.requirementItemId === b.requirementItemId && a.documentSlotId === b.documentSlotId
    && a.file.originalFilename === b.file.originalFilename && a.file.declaredMimeType === b.file.declaredMimeType
    && a.file.byteSize === b.file.byteSize && a.file.sha256Hex === b.file.sha256Hex;
}

export async function runApplicationDocumentUpload(input: Readonly<{
  scope: ApplicationDocumentScope; audience: ApplicationDocumentAudience; target: ApplicationDocumentItemTarget; file: File;
  upload?: ApplicationDocumentUploadFn; env?: ApplicationDocumentPendingEnvironment;
}>): Promise<ApplicationDocumentUploadOutcome> {
  const { scope, audience, target, file, env } = input;
  const upload = input.upload ?? uploadApplicationDocumentFile;
  const itemId = target.requirementItemId;
  const locked = await withApplicationDocumentLock(scope, "upload", itemId, async (): Promise<ApplicationDocumentUploadOutcome> => {
    const saved = readApplicationDocumentPending(scope, "upload", itemId, env?.storage);
    if (saved.blocked) throw new Error("storage_unavailable");
    const old = saved.intent && "file" in saved.intent ? saved.intent as ApplicationDocumentUploadIntent : null;
    // A recovery uses its original revision/item, even after requirements change.
    const originalTarget = old ? { studentCaseId: old.studentCaseId, applicationId: old.applicationId,
      requirementsRevisionId: old.requirementsRevisionId, requirementItemId: old.requirementItemId,
      documentSlotId: old.documentSlotId } : target;
    const next = await freezeApplicationDocumentUploadIntent(originalTarget, file, old?.requestId);
    if (!next) return { status: "invalid_file" };
    if (old && !sameUpload(old, next)) return { status: "wrong_file" };
    const intent = old ?? next;
    persistApplicationDocumentPending(scope, "upload", itemId, intent, env?.storage);
    const result = await upload({ audience, intent, file });
    let cleared = true;
    if (result.ok || result.resolution === "not_written") {
      try { clearApplicationDocumentPending(scope, "upload", itemId, intent, env?.storage); } catch { cleared = false; }
    }
    return result.ok ? { status: "uploaded", receipt: result.receipt, cleared }
      : { status: "rejected", reason: result.reason, resolution: result.resolution };
  }, env);
  return locked.acquired ? locked.value : { status: "locked", reason: locked.reason };
}

export type ApplicationDocumentSubmitOutcome =
  | Readonly<{ status: "sent"; cleared: boolean }>
  | Readonly<{ status: "rejected"; reason: ApplicationDocumentFailure; resolution: Resolution }>
  /** Nothing chosen and no retained intent: the command did not run. */
  | Readonly<{ status: "idle" }>
  /** A retained intent exists and the caller asked not to resend it. */
  | Readonly<{ status: "retained" }>
  /** The command never started (busy elsewhere, or browser storage is unusable). */
  | Readonly<{ status: "locked"; reason: "busy" | "storage_unavailable" }>
  /** The intent is saved on this device but its result was not confirmed. */
  | Readonly<{ status: "unknown" }>;

export async function runApplicationDocumentSubmit(input: Readonly<{
  scope: ApplicationDocumentScope; target: ApplicationDocumentItemTarget;
  selection: ApplicationDocumentSelection | null; previousSubmissionId: string | null;
  submit: ApplicationDocumentSubmitFn;
  /** "resend" repeats a retained intent (the «Проверить результат» button); "stop" leaves it to that button. */
  whenRetained: "resend" | "stop";
  env?: ApplicationDocumentPendingEnvironment; newRequestId?: () => string;
}>): Promise<ApplicationDocumentSubmitOutcome> {
  const { scope, target, selection, env } = input;
  const itemId = target.requirementItemId;
  let persisted = false;
  const locked = await withApplicationDocumentLock(scope, "submit", itemId, async (): Promise<ApplicationDocumentSubmitOutcome> => {
    const saved = readApplicationDocumentPending(scope, "submit", itemId, env?.storage);
    if (saved.blocked) throw new Error("storage_unavailable");
    const old = saved.intent && "selection" in saved.intent ? saved.intent as ApplicationDocumentSubmitIntent : null;
    if (old && input.whenRetained === "stop") return { status: "retained" };
    if (!old && !selection) return { status: "idle" };
    const intent: ApplicationDocumentSubmitIntent = old ?? {
      studentCaseId: target.studentCaseId, applicationId: target.applicationId,
      requirementsRevisionId: target.requirementsRevisionId, requirementItemId: itemId,
      requestId: (input.newRequestId ?? (() => crypto.randomUUID()))(),
      selection: selection!, expectedPreviousSubmissionId: input.previousSubmissionId };
    persistApplicationDocumentPending(scope, "submit", itemId, intent, env?.storage);
    persisted = true;
    const result = await input.submit(scope, intent);
    let cleared = true;
    if (result.ok || result.resolution === "not_written") {
      try { clearApplicationDocumentPending(scope, "submit", itemId, intent, env?.storage); } catch { cleared = false; }
    }
    return result.ok ? { status: "sent", cleared } : { status: "rejected", reason: result.reason, resolution: result.resolution };
  }, env);
  if (locked.acquired) return locked.value;
  // The lock helper reports an exception inside the command as «storage_unavailable».
  return persisted ? { status: "unknown" } : { status: "locked", reason: locked.reason };
}

export type ApplicationDocumentUploadAndSubmitOutcome =
  | Readonly<{ stage: "upload"; upload: Exclude<ApplicationDocumentUploadOutcome, { status: "uploaded" }> }>
  | Readonly<{
    stage: "done"; upload: Extract<ApplicationDocumentUploadOutcome, { status: "uploaded" }>;
    /** "skipped": upload only (staff, or the student may not submit), or the saved file belongs to older requirements. */
    submit: ApplicationDocumentSubmitOutcome | Readonly<{ status: "skipped"; why: "upload_only" | "target_changed" }>;
  }>;

/**
 * Student one tap: upload, and once the receipt is confirmed send exactly that
 * saved version for review. Nothing is sent without a confirmed receipt, and a
 * retained earlier submit intent is never resent in place of the new file.
 */
export async function runApplicationDocumentUploadAndSubmit(input: Readonly<{
  scope: ApplicationDocumentScope; audience: ApplicationDocumentAudience; target: ApplicationDocumentItemTarget; file: File;
  sendAfterUpload: Readonly<{ previousSubmissionId: string | null; submit: ApplicationDocumentSubmitFn }> | null;
  upload?: ApplicationDocumentUploadFn; env?: ApplicationDocumentPendingEnvironment; newRequestId?: () => string;
  onStage?: (stage: "upload" | "submit") => void;
}>): Promise<ApplicationDocumentUploadAndSubmitOutcome> {
  const { scope, target } = input;
  const stage = (value: "upload" | "submit") => { try { input.onStage?.(value); } catch { /* Display callbacks never change the outcome. */ } };
  stage("upload");
  const upload = await runApplicationDocumentUpload({ scope, audience: input.audience, target, file: input.file, upload: input.upload, env: input.env });
  if (upload.status !== "uploaded") return { stage: "upload", upload };
  const send = input.audience === "student" ? input.sendAfterUpload : null;
  if (!send) return { stage: "done", upload, submit: { status: "skipped", why: "upload_only" } };
  const receipt = upload.receipt;
  // A retained upload from older requirements saved into its original revision; sending it needs the user's eyes.
  if (receipt.studentCaseId !== target.studentCaseId || receipt.applicationId !== target.applicationId
    || receipt.requirementsRevisionId !== target.requirementsRevisionId || receipt.requirementItemId !== target.requirementItemId
    || receipt.documentSlotId !== target.documentSlotId) return { stage: "done", upload, submit: { status: "skipped", why: "target_changed" } };
  stage("submit");
  const submit = await runApplicationDocumentSubmit({
    scope, target, previousSubmissionId: send.previousSubmissionId, submit: send.submit, whenRetained: "stop",
    selection: { kind: "program_upload", uploadContextId: receipt.uploadContextId, documentVersionId: receipt.documentVersionId },
    env: input.env, newRequestId: input.newRequestId,
  });
  return { stage: "done", upload, submit };
}
