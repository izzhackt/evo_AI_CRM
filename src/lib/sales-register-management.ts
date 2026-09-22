import { parseSalesDate, parseSalesUuid, type SalesRegisterTarget } from "./platform-sales-register-contract.ts";

export type SalesRegisterManagement = Readonly<{
  reportMonth: string | null;
  canManageTarget: boolean;
  canImport: boolean;
  target: SalesRegisterTarget | null;
}>;

export type SalesRegisterManagementRead =
  | Readonly<{ status: "ready"; data: SalesRegisterManagement }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

function unavailable(): never {
  throw new Error("Sales management is unavailable.");
}

function exact(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unavailable();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return unavailable();
  return value;
}

/** Authority and nullable target are one response, never inferred from the report's targets array. */
export function parseSalesRegisterManagement(
  raw: unknown, organizationId: string, reportMonth: string | null,
): SalesRegisterManagement {
  if (typeof organizationId !== "string" || parseSalesUuid(organizationId) !== organizationId
    || (reportMonth !== null && (parseSalesDate(reportMonth) !== reportMonth || !reportMonth.endsWith("-01")))) return unavailable();
  const value = exact(raw, ["schema_version", "organization_id", "report_month", "can_manage_target", "can_import", "target"]);
  if (value.schema_version !== 1 || value.organization_id !== organizationId || value.report_month !== reportMonth
    || typeof value.can_manage_target !== "boolean" || typeof value.can_import !== "boolean") return unavailable();

  let target: SalesRegisterTarget | null = null;
  if (value.target !== null) {
    if (!value.can_manage_target || reportMonth === null) return unavailable();
    const row = exact(value.target, ["id", "version", "report_month", "manager_label", "target_count"]);
    const id = parseSalesUuid(row.id);
    if (!id || typeof row.version !== "string" || !/^[1-9]\d{0,15}$/.test(row.version)
      || !Number.isSafeInteger(Number(row.version)) || row.report_month !== reportMonth || row.manager_label !== null
      || typeof row.target_count !== "number" || !Number.isInteger(row.target_count)
      || row.target_count < 0 || row.target_count > 1_000_000) return unavailable();
    target = { id, version: Number(row.version), reportMonth, managerLabel: null, targetCount: row.target_count };
  }
  return { reportMonth, canManageTarget: value.can_manage_target, canImport: value.can_import, target };
}
