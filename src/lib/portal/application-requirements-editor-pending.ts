import {
  parseApplicationRequirementsEditorIntent, parseApplicationRequirementsEditorReceipt,
  type RequirementsEditorScope, type ApplicationRequirementsEditorIntent, type ApplicationRequirementsEditorResult,
} from "./application-requirements-editor.ts";
import { universityIntakeId as uuid } from "../platform-university-catalog.ts";

export const EDITOR_PENDING_EVENT = "evo-requirements-editor-pending";
export type EditorPendingState = Readonly<{ intent: ApplicationRequirementsEditorIntent | null; blocked: boolean }>;
export type EditorPendingResult = ApplicationRequirementsEditorResult | Readonly<{ ok: false; reason: "storage_unavailable" | "busy" | "pending_conflict" | "no_pending"; resolution: "retain" }>;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Injectable browser ports are solely for protocol/control-flow tests, never a runtime fallback. */
export type EditorPendingEnvironment = Readonly<{ storage: StoragePort; locks: Pick<LockManager, "request">; notify?: () => void }>;
type Envelope = Readonly<{ protocolVersion: 1; scope: RequirementsEditorScope; intent: ApplicationRequirementsEditorIntent }>;
const retained = (reason: "storage_unavailable" | "busy" | "pending_conflict" | "no_pending"): EditorPendingResult => ({ ok: false, reason, resolution: "retain" });
const unavailable = (): ApplicationRequirementsEditorResult => ({ ok: false, reason: "unavailable", resolution: "retain" });
function validScope(scope: RequirementsEditorScope) { return scope && uuid(scope.organizationId) && uuid(scope.membershipId) && uuid(scope.studentCaseId) && uuid(scope.applicationId); }
export function editorPendingKey(scope: RequirementsEditorScope): string {
  if (!validScope(scope)) throw new Error("Invalid editor scope");
  return `evo.staff.requirements-editor.v1:${scope.organizationId}:${scope.membershipId}:${scope.studentCaseId}:${scope.applicationId}`;
}
function normalizedScope(scope: RequirementsEditorScope): RequirementsEditorScope {
  return { organizationId: scope.organizationId, membershipId: scope.membershipId, studentCaseId: scope.studentCaseId, applicationId: scope.applicationId };
}
/** JSON object key order is immaterial; every array (including source decisions) keeps its order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item !== null && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function envelope(scope: RequirementsEditorScope, intent: ApplicationRequirementsEditorIntent): string {
  return canonical({ protocolVersion: 1, scope: normalizedScope(scope), intent } satisfies Envelope);
}
function decode(raw: string | null, scope: RequirementsEditorScope): EditorPendingState {
  if (raw === null) return { intent: null, blocked: false };
  try {
    if (raw.length > 1024 * 1024 + 4096) return { intent: null, blocked: true };
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "intent,protocolVersion,scope" || value.protocolVersion !== 1
      || canonical(value.scope) !== canonical(normalizedScope(scope))) return { intent: null, blocked: true };
    const intent = parseApplicationRequirementsEditorIntent(value.intent);
    if (!intent || intent.studentCaseId !== scope.studentCaseId || intent.applicationId !== scope.applicationId) return { intent: null, blocked: true };
    return { intent, blocked: false };
  } catch { return { intent: null, blocked: true }; }
}
export function readEditorPending(scope: RequirementsEditorScope, storage?: StoragePort): EditorPendingState {
  try { return decode((storage ?? window.localStorage).getItem(editorPendingKey(scope)), scope); }
  catch { return { intent: null, blocked: true }; }
}
function environment(): EditorPendingEnvironment {
  // Property access itself may throw when storage is disabled; callers fail closed.
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("Editor persistence unavailable");
  return { storage: window.localStorage, locks: navigator.locks, notify: () => window.dispatchEvent(new Event(EDITOR_PENDING_EVENT)) };
}
function notify(env: EditorPendingEnvironment) { try { env.notify?.(); } catch { /* Notification failure never changes a known command outcome. */ } }

/** Only an explicit user action calls this. Null means replay the already retained intent. */
export async function sendEditorPending(
  scope: RequirementsEditorScope,
  proposedIntent: ApplicationRequirementsEditorIntent | null,
  send: (intent: ApplicationRequirementsEditorIntent) => Promise<ApplicationRequirementsEditorResult>,
  injectedEnvironment?: EditorPendingEnvironment,
): Promise<EditorPendingResult> {
  let settled: EditorPendingResult | undefined;
  try {
    scope = normalizedScope(scope);
    const key = editorPendingKey(scope), env = injectedEnvironment ?? environment();
    if (!env.locks?.request) return retained("storage_unavailable");
    // Capture before even awaiting the browser lock; the caller may edit its draft meanwhile.
    const proposed = proposedIntent === null ? null : parseApplicationRequirementsEditorIntent(proposedIntent);
    if (proposedIntent !== null && (!proposed || proposed.studentCaseId !== scope.studentCaseId || proposed.applicationId !== scope.applicationId)) return { ok: false, reason: "invalid", resolution: "retain" };
    const proposal = proposed === null ? null : canonical(proposed);
    return await env.locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) return retained("busy");
      let raw: string | null;
      try { raw = env.storage.getItem(key); } catch { return retained("storage_unavailable"); }
      const state = decode(raw, scope);
      if (state.blocked) return retained("storage_unavailable");
      if (state.intent && proposal && canonical(state.intent) !== proposal) return retained("pending_conflict");
      const next = state.intent ?? (proposal === null ? null : parseApplicationRequirementsEditorIntent(JSON.parse(proposal)));
      if (!next) return retained("no_pending");
      // Freeze a detached JSON copy before the first await/RPC, never the live React draft.
      const serialized = envelope(scope, next);
      const intent = decode(serialized, scope).intent;
      if (!intent) return retained("storage_unavailable");
      try {
        if (!state.intent) { env.storage.setItem(key, serialized); raw = serialized; notify(env); }
        if (env.storage.getItem(key) !== raw) return retained("pending_conflict");
      } catch { return retained("storage_unavailable"); }
      let result: ApplicationRequirementsEditorResult;
      try {
        const response = await send(JSON.parse(canonical(intent)));
        if (response?.ok === true) {
          const receipt = parseApplicationRequirementsEditorReceipt(response.receipt, intent);
          result = receipt ? { ok: true, receipt } : unavailable();
        } else if (response?.ok === false && ["invalid", "forbidden", "request_conflict", "stale_context", "case_ineligible", "application_ineligible", "legacy_configuration_conflict", "editor_limit", "unavailable"].includes(response.reason)) {
          const definitive = response.resolution === "not_written" && ["stale_context", "case_ineligible", "application_ineligible", "legacy_configuration_conflict"].includes(response.reason);
          result = { ok: false, reason: response.reason, resolution: definitive ? "not_written" : "retain" };
        } else result = unavailable();
      } catch { result = unavailable(); }
      settled = result;
      if (result.ok || result.resolution === "not_written") {
        // Do not clear another tab/component's newer entry. Storage failure after
        // a receipt preserves success and leaves the original safe replay intact.
        try { if (env.storage.getItem(key) === raw) env.storage.removeItem(key); } catch { /* Keep retained intent. */ }
        notify(env);
      }
      return result;
    });
  } catch { return settled ?? retained("storage_unavailable"); }
}
