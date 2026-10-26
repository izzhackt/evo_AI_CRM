/**
 * Display rules of the student one-tap upload («Загрузить и отправить на проверку»).
 * Kept free of React so the rules that decide what the student reads are testable.
 */

/**
 * A result that must outlive the remount which the refresh after the save causes:
 * a new server snapshot re-keys the item, and its form-local message is lost with it.
 */
export type ApplicationDocumentNotice = Readonly<{
  /** "error": the file is saved but not sent. "success": the file was sent for review. */
  tone: "error" | "success";
  text: string;
  /** The saved document version this notice speaks about. */
  versionId: string;
}>;

/** What the freshest server snapshot of the item says. */
export type ApplicationDocumentNoticeView = Readonly<{
  /** Version of the current submission, if any. */
  submittedVersionId: string | null;
  /** Staff already decided on the current submission. */
  reviewed: boolean;
  /** Version of the saved file that has not been sent yet, if any. */
  unsentDraftVersionId: string | null;
}>;

/** Whether a kept notice still describes the item as it is now. */
export function applicationDocumentNoticeVisible(notice: ApplicationDocumentNotice | null, view: ApplicationDocumentNoticeView): boolean {
  if (!notice) return false;
  // «Sent» holds while that very version is the current submission and no decision has replaced the wait.
  if (notice.tone === "success") return view.submittedVersionId === notice.versionId && !view.reviewed;
  // «Saved, not sent» holds only while that file still waits unsent.
  return view.submittedVersionId !== notice.versionId
    && (view.unsentDraftVersionId === null || view.unsentDraftVersionId === notice.versionId);
}

/**
 * The page-level hint under the document list. It may only claim what is true for
 * every document the student can upload to. Two steps are certain only when no such
 * document may be sent. One tap is never claimed here: a document whose earlier send is
 * still unfinished on this device falls back to two steps, so each document's own hint speaks.
 */
export function studentDocumentPageHint(items: readonly Readonly<{ canUpload: boolean; canSubmit: boolean }>[] | null | undefined): "two_step" | null {
  const uploadable = (items ?? []).filter(item => item.canUpload);
  return uploadable.length && !uploadable.some(item => item.canSubmit) ? "two_step" : null;
}
