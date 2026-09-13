/** Installed D4 producer contract. Values are obtained only through the staff session. */
export const DOCUMENT_EXPORT_TEMPLATE_SHA256 = "2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0";
export const DOCUMENT_EXPORT_RENDERER_VERSION = "evo-student-profile-docx-v1";
export const DOCUMENT_EXPORT_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOCUMENT_EXPORT_MAX_BYTES = 5 * 1024 * 1024;
export type DocumentExportMode = "draft" | "final";
export type DocumentExportState = "pending" | "stored_unverified" | "ready" | "unknown" | "failed";
export type DocumentExportFailure = "profile_not_ready" | "source_changed" | "access_changed" | "source_unavailable"
  | "template_unavailable" | "integrity_failed" | "export_failed" | "storage_unavailable";
export type DocumentExportReceipt = Readonly<{
  id: string; student_case_id: string; student_profile_id: string; profile_revision: number;
  workspace_revision: string; input_snapshot_sha256: string; field_reviews_sha256: string;
  kind: "student_profile"; mode: DocumentExportMode; state: DocumentExportState;
  template_sha256: string; renderer_version: string; created_at: string; ready_at: string | null;
  output_sha256: string | null; output_bytes: number | null; mime_type: typeof DOCUMENT_EXPORT_MIME;
  receipt_id: string | null; failure_code: DocumentExportFailure | null; historical: boolean; can_download: boolean;
}>;
export type DocumentExportWorkspace = Readonly<{
  schema_version: 1; student_case_id: string; profile: Readonly<{ id: string; revision: number }> | null;
  workspace_revision: string | null; can_export: boolean; artifacts: readonly DocumentExportReceipt[];
}>;
export type DocumentExportPreparation = Readonly<{
  schema_version: 1; preparation_id: string; artifact: DocumentExportReceipt;
  /** Existing exact D2 SQL DTO, to be validated with normalizePlatformStudentProfileFieldsSnapshot. */
  frozen_profile: unknown | null;
}>;
export type DocumentExportBeginning = Readonly<{
  artifact: DocumentExportReceipt; created: boolean; claim_token: string | null;
}>;
export type DocumentExportStorageTarget = Readonly<{
  bucket_id: "platform-document-exports"; object_name: string; mime_type: typeof DOCUMENT_EXPORT_MIME;
  expires_at: string;
}>;
export type DocumentExportSeal = Readonly<{ artifact: DocumentExportReceipt; storage: DocumentExportStorageTarget | null }>;
export type DocumentExportReconciliation = Readonly<{ artifact: DocumentExportReceipt; storage: DocumentExportStorageTarget | null }>;
export type DocumentExportDownloadGrant = Readonly<{ grant_id: string; artifact_id: string; expires_at: string; consumed: boolean }>;
export type DocumentExportDownloadConsumption = Readonly<{
  grant_id: string; artifact: DocumentExportReceipt; storage: DocumentExportStorageTarget;
}>;

/** JSONB RPC replies; never send claim_token, frozen_profile or storage to the browser. */
export interface DocumentExportRpcContract {
  staff_document_export_workspace: { args: { p_student_case_id: string }; result: DocumentExportWorkspace };
  prepare_document_export: { args: { p_student_case_id: string; p_mode: DocumentExportMode;
    p_expected_workspace_revision: string; p_request_id: string }; result: DocumentExportPreparation };
  begin_document_export: { args: { p_preparation_id: string; p_actor_auth_user_id: string; p_actor_membership_id: string };
    result: DocumentExportBeginning };
  seal_document_export_output: { args: { p_artifact_id: string; p_claim_token: string; p_output_sha256: string; p_output_bytes: number };
    result: DocumentExportSeal };
  complete_document_export: { args: { p_artifact_id: string; p_claim_token: string;
    p_outcome: "ready" | "failed" | "unknown"; p_failure_code: DocumentExportFailure | null;
    p_observed_sha256: string | null; p_observed_bytes: number | null }; result: DocumentExportReceipt };
  inspect_document_export_reconciliation: { args: { p_artifact_id: string; p_actor_auth_user_id: string;
    p_actor_membership_id: string }; result: DocumentExportReconciliation };
  reconcile_document_export: { args: { p_artifact_id: string; p_actor_auth_user_id: string; p_actor_membership_id: string;
    p_request_id: string; p_observed_sha256: string | null; p_observed_bytes: number | null;
    p_failure_code: "source_unavailable" | "storage_unavailable" | "integrity_failed" | null }; result: DocumentExportReceipt };
  grant_document_export_download: { args: { p_artifact_id: string; p_request_id: string }; result: DocumentExportDownloadGrant };
  consume_document_export_download: { args: { p_grant_id: string; p_actor_auth_user_id: string; p_actor_membership_id: string };
    result: DocumentExportDownloadConsumption };
  complete_document_export_download: { args: { p_grant_id: string; p_actor_auth_user_id: string; p_actor_membership_id: string;
    p_observed_sha256: string | null; p_observed_bytes: number | null }; result: Readonly<{
      grant_id: string; artifact_id: string; verified: boolean; failure_code: DocumentExportFailure | null;
    }> };
}
