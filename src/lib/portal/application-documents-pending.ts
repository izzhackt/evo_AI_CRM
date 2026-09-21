import { universityIntakeId as uuid } from "../platform-university-catalog.ts";
import {
  applicationDocumentCanonical as canonical, applicationDocumentExact as exact, applicationDocumentRecord as record,
  parseApplicationDocumentUploadIntent, parseApplicationDocumentSubmitIntent, parseApplicationDocumentReviewIntent,
  type ApplicationDocumentOwner, type ApplicationDocumentScope, type ApplicationDocumentUploadIntent, type ApplicationDocumentSubmitIntent, type ApplicationDocumentReviewIntent,
} from "./application-documents.ts";

export const APPLICATION_DOCUMENT_PENDING_EVENT = "evo-application-document-pending";
export type ApplicationDocumentOperation = "upload" | "submit" | "review";
export type ApplicationDocumentPendingIntent = ApplicationDocumentUploadIntent | ApplicationDocumentSubmitIntent | ApplicationDocumentReviewIntent;
export type ApplicationDocumentPending = Readonly<{ intent: ApplicationDocumentPendingIntent | null; blocked: boolean }>;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type ApplicationDocumentPendingEnvironment = Readonly<{ storage: StoragePort; locks: Pick<LockManager, "request">; notify?: () => void }>;
const operations = ["upload", "submit", "review"] as const;
function normalizeScope(scope: ApplicationDocumentScope): ApplicationDocumentScope {
  if (!scope || ![scope.organizationId, scope.membershipId, scope.studentCaseId, scope.applicationId].every(uuid)) throw new Error("Application document scope unavailable");
  return { organizationId: scope.organizationId, membershipId: scope.membershipId, studentCaseId: scope.studentCaseId, applicationId: scope.applicationId };
}
function prefix(scope: ApplicationDocumentScope): string {
  const s = normalizeScope(scope);
  return `evo.application-documents.v1:${s.organizationId}:${s.membershipId}:${s.studentCaseId}:${s.applicationId}:`;
}
export function applicationDocumentPendingKey(scope: ApplicationDocumentScope, operation: ApplicationDocumentOperation, target: string): string {
  if (!operations.includes(operation) || !uuid(target)) throw new Error("Application document operation unavailable");
  return `${prefix(scope)}${operation}:${target}`;
}
function parsedIntent(scope: ApplicationDocumentScope, operation: ApplicationDocumentOperation, target: string, value: unknown): ApplicationDocumentPendingIntent | null {
  if (operation === "review") {
    const intent = parseApplicationDocumentReviewIntent(value);
    return intent?.submissionId === target ? intent : null;
  }
  const intent = operation === "upload" ? parseApplicationDocumentUploadIntent(value) : parseApplicationDocumentSubmitIntent(value);
  return intent?.requirementItemId === target && intent.studentCaseId === scope.studentCaseId && intent.applicationId === scope.applicationId ? intent : null;
}
function decode(raw: string | null, scope: ApplicationDocumentScope, operation: ApplicationDocumentOperation, target: string): ApplicationDocumentPending {
  if (raw === null) return { intent: null, blocked: false };
  try {
    if (raw.length > 16384) return { intent: null, blocked: true };
    const row = record(JSON.parse(raw));
    if (!row || !exact(row, ["protocolVersion", "scope", "operation", "target", "intent"]) || row.protocolVersion !== 1
      || canonical(row.scope) !== canonical(normalizeScope(scope)) || row.operation !== operation || row.target !== target) return { intent: null, blocked: true };
    const intent = parsedIntent(scope, operation, target, row.intent);
    return intent ? { intent, blocked: false } : { intent: null, blocked: true };
  } catch { return { intent: null, blocked: true }; }
}
function notify() {
  try { if (typeof window !== "undefined") window.dispatchEvent(new Event(APPLICATION_DOCUMENT_PENDING_EVENT)); } catch { /* Retained intent remains authoritative. */ }
}
export function readApplicationDocumentPending(scope: ApplicationDocumentScope, operation: ApplicationDocumentOperation, target: string, storage?: StoragePort): ApplicationDocumentPending {
  try { return decode((storage ?? window.localStorage).getItem(applicationDocumentPendingKey(scope, operation, target)), scope, operation, target); }
  catch { return { intent: null, blocked: true }; }
}
/** Call only inside withApplicationDocumentLock; never overwrite a different unknown command. */
export function persistApplicationDocumentPending(scope: ApplicationDocumentScope, operation: ApplicationDocumentOperation, target: string, value: ApplicationDocumentPendingIntent, storage?: StoragePort): void {
  const port = storage ?? window.localStorage, key = applicationDocumentPendingKey(scope, operation, target), intent = parsedIntent(scope, operation, target, value);
  if (!intent) throw new Error("Application document pending invalid");
  const prior = decode(port.getItem(key), scope, operation, target);
  if (prior.blocked || (prior.intent && canonical(prior.intent) !== canonical(intent))) throw new Error("Application document pending conflict");
  const raw = canonical({ protocolVersion: 1, scope: normalizeScope(scope), operation, target, intent });
  port.setItem(key, raw);
  if (port.getItem(key) !== raw) throw new Error("Application document persistence unavailable");
  notify();
}
/** Only clear after a validated receipt or SQL-certified same-intent no-write result. */
export function clearApplicationDocumentPending(scope: ApplicationDocumentScope, operation: ApplicationDocumentOperation, target: string, value: ApplicationDocumentPendingIntent, storage?: StoragePort): void {
  const port = storage ?? window.localStorage, key = applicationDocumentPendingKey(scope, operation, target), intent = parsedIntent(scope, operation, target, value);
  if (!intent) return;
  const raw = port.getItem(key), prior = decode(raw, scope, operation, target);
  if (!prior.blocked && prior.intent && canonical(prior.intent) === canonical(intent) && port.getItem(key) === raw) { port.removeItem(key); notify(); }
}
export function listApplicationDocumentPending(scope: ApplicationDocumentScope, storage?: StoragePort): readonly Readonly<{
  operation: ApplicationDocumentOperation; target: string; intent: ApplicationDocumentPendingIntent | null; blocked: boolean;
}>[] {
  try {
    const port = storage ?? window.localStorage, scopedPrefix = prefix(scope), result = [];
    for (let index = 0; index < port.length; index++) {
      const key = port.key(index);
      // localStorage cannot enumerate a prefix; values from other scopes are never read.
      if (!key?.startsWith(scopedPrefix)) continue;
      const [operation, target, extra] = key.slice(scopedPrefix.length).split(":");
      if (extra !== undefined || !operations.includes(operation as ApplicationDocumentOperation) || !uuid(target)) continue;
      result.push({ operation: operation as ApplicationDocumentOperation, target, ...decode(port.getItem(key), scope, operation as ApplicationDocumentOperation, target) });
    }
    return result.sort((a, b) => `${a.operation}:${a.target}`.localeCompare(`${b.operation}:${b.target}`));
  } catch { throw new Error("Application document pending inventory unavailable"); }
}
/** Discover review recovery scopes from keys only; decode each retained intent separately. */
export function listApplicationDocumentPendingScopes(owner: ApplicationDocumentOwner, operation: "review", storage?: StoragePort): readonly ApplicationDocumentScope[] {
  try {
    if (!owner || !uuid(owner.organizationId) || !uuid(owner.membershipId) || operation !== "review") throw new Error("Invalid owner");
    const port = storage ?? window.localStorage;
    const ownerPrefix = `evo.application-documents.v1:${owner.organizationId}:${owner.membershipId}:`;
    const scopes = new Map<string, ApplicationDocumentScope>();
    for (let index = 0; index < port.length; index++) {
      const key = port.key(index);
      // Never read values here, including those belonging to this owner.
      if (!key?.startsWith(ownerPrefix)) continue;
      const parts = key.slice(ownerPrefix.length).split(":");
      if (parts.length !== 4) continue;
      const [studentCaseId, applicationId, keyOperation, target] = parts;
      if (keyOperation !== operation || ![studentCaseId, applicationId, target].every(uuid)) continue;
      scopes.set(`${studentCaseId}:${applicationId}`, { organizationId: owner.organizationId, membershipId: owner.membershipId, studentCaseId, applicationId });
    }
    return [...scopes.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, scope]) => scope);
  } catch { throw new Error("Application document pending scope inventory unavailable"); }
}
export async function withApplicationDocumentLock<T>(scope: ApplicationDocumentScope, operation: ApplicationDocumentOperation, target: string, fn: () => Promise<T>, env?: ApplicationDocumentPendingEnvironment): Promise<
  Readonly<{ acquired: true; value: T }> | Readonly<{ acquired: false; reason: "busy" | "storage_unavailable" }>
> {
  try {
    const key = applicationDocumentPendingKey(normalizeScope(scope), operation, target);
    const locks = env?.locks ?? (typeof navigator === "undefined" ? null : navigator.locks);
    if (!locks?.request) return { acquired: false, reason: "storage_unavailable" };
    // Touching storage may throw independently of LockManager availability.
    (env?.storage ?? window.localStorage).getItem(key);
    return await locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => lock
      ? { acquired: true as const, value: await fn() } : { acquired: false as const, reason: "busy" as const });
  } catch { return { acquired: false, reason: "storage_unavailable" }; }
}
