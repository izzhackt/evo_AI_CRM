import { universityIntakeId as uuid } from "../platform-university-catalog.ts";
import { applicationDocumentCanonical as canonical, applicationDocumentExact as exact, applicationDocumentRecord as record,
  type ApplicationDocumentOwner, type ApplicationDocumentScope } from "./application-documents.ts";
import { parseApplicationPackageSubmitIntent, parseApplicationPackageReviewIntent, parseApplicationPackageRecovery,
  type ApplicationPackageSubmitIntent, type ApplicationPackageReviewIntent, type ApplicationPackageOperation } from "./application-packages.ts";

export type ApplicationPackageScope = ApplicationDocumentScope;
export type ApplicationPackagePendingIntent = ApplicationPackageSubmitIntent | ApplicationPackageReviewIntent;
export type ApplicationPackagePending = Readonly<{ intent: ApplicationPackagePendingIntent | null; blocked: boolean }>;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type ApplicationPackagePendingEnvironment = Readonly<{ storage: StoragePort; locks: Pick<LockManager, "request"> }>;
export const APPLICATION_PACKAGE_PENDING_EVENT = "evo-application-package-pending";
const MAX_PENDING_LENGTH = 262144;
const operations: readonly ApplicationPackageOperation[] = ["submit", "review"];
function normalizedScope(scope: ApplicationPackageScope): ApplicationPackageScope {
  if (!scope || ![scope.organizationId, scope.membershipId, scope.studentCaseId, scope.applicationId].every(uuid)) throw new Error("Application package scope unavailable");
  return { organizationId: scope.organizationId, membershipId: scope.membershipId, studentCaseId: scope.studentCaseId, applicationId: scope.applicationId };
}
function prefix(scope: ApplicationPackageScope): string {
  const value = normalizedScope(scope);
  return `evo.application-packages.v1:${value.organizationId}:${value.membershipId}:${value.studentCaseId}:${value.applicationId}:`;
}
export function applicationPackagePendingKey(scope: ApplicationPackageScope, operation: ApplicationPackageOperation, target: string): string {
  if (!operations.includes(operation) || !uuid(target)) throw new Error("Application package operation unavailable");
  return `${prefix(scope)}${operation}:${target}`;
}
function parsedIntent(scope: ApplicationPackageScope, operation: ApplicationPackageOperation, target: string, value: unknown): ApplicationPackagePendingIntent | null {
  const intent = operation === "submit" ? parseApplicationPackageSubmitIntent(value) : parseApplicationPackageReviewIntent(value);
  if (!intent || intent.studentCaseId !== scope.studentCaseId || intent.applicationId !== scope.applicationId) return null;
  return (operation === "submit" ? (intent as ApplicationPackageSubmitIntent).requirementsRevisionId : (intent as ApplicationPackageReviewIntent).packageId) === target ? intent : null;
}
function decode(raw: string | null, scope: ApplicationPackageScope, operation: ApplicationPackageOperation, target: string): ApplicationPackagePending {
  if (raw === null) return { intent: null, blocked: false };
  try {
    if (raw.length > MAX_PENDING_LENGTH) return { intent: null, blocked: true };
    const row = record(JSON.parse(raw));
    if (!row || !exact(row, ["protocolVersion", "scope", "operation", "target", "intent"]) || row.protocolVersion !== 1
      || canonical(row.scope) !== canonical(normalizedScope(scope)) || row.operation !== operation || row.target !== target) return { intent: null, blocked: true };
    const intent = parsedIntent(scope, operation, target, row.intent);
    return intent ? { intent, blocked: false } : { intent: null, blocked: true };
  } catch { return { intent: null, blocked: true }; }
}
function notify(): void {
  try { if (typeof window !== "undefined") window.dispatchEvent(new Event(APPLICATION_PACKAGE_PENDING_EVENT)); } catch { /* Stored intent remains available. */ }
}
export function readApplicationPackagePending(scope: ApplicationPackageScope, operation: ApplicationPackageOperation, target: string, storage?: StoragePort): ApplicationPackagePending {
  try { return decode((storage ?? window.localStorage).getItem(applicationPackagePendingKey(scope, operation, target)), scope, operation, target); }
  catch { return { intent: null, blocked: true }; }
}
/** Use under withApplicationPackageLock; a different unknown command is never overwritten. */
export function persistApplicationPackagePending(scope: ApplicationPackageScope, operation: ApplicationPackageOperation, target: string, value: ApplicationPackagePendingIntent, storage?: StoragePort): void {
  const port = storage ?? window.localStorage, key = applicationPackagePendingKey(scope, operation, target), intent = parsedIntent(scope, operation, target, value);
  if (!intent) throw new Error("Application package pending invalid");
  const prior = decode(port.getItem(key), scope, operation, target);
  if (prior.blocked || (prior.intent && canonical(prior.intent) !== canonical(intent))) throw new Error("Application package pending conflict");
  const raw = canonical({ protocolVersion: 1, scope: normalizedScope(scope), operation, target, intent });
  if (raw.length > MAX_PENDING_LENGTH) throw new Error("Application package pending too large");
  port.setItem(key, raw);
  if (port.getItem(key) !== raw) throw new Error("Application package persistence unavailable");
  notify();
}
/** Under the same lock, accept only a matching receipt or authoritative recovery proof. */
export function clearApplicationPackagePending(scope: ApplicationPackageScope, operation: ApplicationPackageOperation, target: string, value: ApplicationPackagePendingIntent, proof: unknown, storage?: StoragePort): boolean {
  const port = storage ?? window.localStorage, key = applicationPackagePendingKey(scope, operation, target), intent = parsedIntent(scope, operation, target, value);
  if (!intent || !parseApplicationPackageRecovery(proof, operation, intent)) return false;
  const raw = port.getItem(key), prior = decode(raw, scope, operation, target);
  if (prior.blocked || !prior.intent || canonical(prior.intent) !== canonical(intent) || port.getItem(key) !== raw) return false;
  port.removeItem(key);
  if (port.getItem(key) !== null) throw new Error("Application package clearing unavailable");
  notify();
  return true;
}
export function listApplicationPackagePending(scope: ApplicationPackageScope, storage?: StoragePort): readonly Readonly<{
  operation: ApplicationPackageOperation; target: string; intent: ApplicationPackagePendingIntent | null; blocked: boolean;
}>[] {
  const port = storage ?? window.localStorage, scopedPrefix = prefix(scope), result = [];
  for (let index = 0; index < port.length; index++) {
    const key = port.key(index);
    if (!key?.startsWith(scopedPrefix)) continue;
    const parts = key.slice(scopedPrefix.length).split(":");
    if (parts.length !== 2 || !operations.includes(parts[0] as ApplicationPackageOperation) || !uuid(parts[1])) continue;
    const operation = parts[0] as ApplicationPackageOperation, target = parts[1];
    result.push({ operation, target, ...decode(port.getItem(key), scope, operation, target) });
  }
  return result.sort((a, b) => `${a.operation}:${a.target}`.localeCompare(`${b.operation}:${b.target}`));
}
/** Enumerate keys only. Values belonging to another owner are never read. */
export function listApplicationPackagePendingScopes(owner: ApplicationDocumentOwner, storage?: StoragePort): readonly ApplicationPackageScope[] {
  if (!owner || !uuid(owner.organizationId) || !uuid(owner.membershipId)) throw new Error("Invalid owner");
  const port = storage ?? window.localStorage, ownerPrefix = `evo.application-packages.v1:${owner.organizationId}:${owner.membershipId}:`;
  const scopes = new Map<string, ApplicationPackageScope>();
  for (let index = 0; index < port.length; index++) {
    const key = port.key(index);
    if (!key?.startsWith(ownerPrefix)) continue;
    const parts = key.slice(ownerPrefix.length).split(":");
    if (parts.length !== 4) continue;
    const [studentCaseId, applicationId, operation, target] = parts;
    if (![studentCaseId, applicationId, target].every(uuid) || !operations.includes(operation as ApplicationPackageOperation)) continue;
    scopes.set(`${studentCaseId}:${applicationId}`, { organizationId: owner.organizationId, membershipId: owner.membershipId, studentCaseId, applicationId });
  }
  return [...scopes.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, scope]) => scope);
}
export async function withApplicationPackageLock<T>(scope: ApplicationPackageScope, operation: ApplicationPackageOperation, target: string, fn: () => Promise<T>, env?: ApplicationPackagePendingEnvironment): Promise<
  Readonly<{ acquired: true; value: T }> | Readonly<{ acquired: false; reason: "busy" | "storage_unavailable" }>
> {
  try {
    const key = applicationPackagePendingKey(scope, operation, target), locks = env?.locks ?? (typeof navigator === "undefined" ? null : navigator.locks);
    if (!locks?.request) return { acquired: false, reason: "storage_unavailable" };
    (env?.storage ?? window.localStorage).getItem(key);
    return await locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => lock
      ? { acquired: true as const, value: await fn() } : { acquired: false as const, reason: "busy" as const });
  } catch { return { acquired: false, reason: "storage_unavailable" }; }
}
