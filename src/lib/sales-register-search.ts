import { parseSalesRegisterWorkspace, type SalesRegisterWorkspace } from "./platform-sales-register-contract.ts";

/** Empty means no search; null means invalid input. Bound the original input. */
export function parseSalesRegisterSearchQuery(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 400 || [...value].length > 200
    || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim();
}

export type SalesRegisterSearchWorkspace = SalesRegisterWorkspace & Readonly<{ query: string | null }>;

/** v1 remains strict and unchanged; v2 adds exactly one normalized query echo. */
export function parseSalesRegisterSearchWorkspace(raw: unknown, organizationId: string): SalesRegisterSearchWorkspace {
  const unavailable = () => new Error("Sales register is unavailable.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(raw, "query")) throw unavailable();
  const { query, ...workspace } = raw as Record<string, unknown>;
  if (query !== null && (typeof query !== "string" || query === "" || parseSalesRegisterSearchQuery(query) !== query)) throw unavailable();
  return { ...parseSalesRegisterWorkspace(workspace, organizationId), query: query as string | null };
}
