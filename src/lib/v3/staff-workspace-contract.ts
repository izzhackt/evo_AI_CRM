export const STAFF_ROLES = ["admin", "sales", "curator"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Администратор", sales: "Продажи", curator: "Поступление",
};
export type StaffWorkspaceMember = Readonly<{
  membershipId: string; displayName: string; role: StaffRole; status: string; version: number;
}>;
export type StaffAuthRequest = Readonly<{
  requestId: string; operation: "invite" | "recovery"; displayName: string;
  status: "dispatching" | "reconciliation_required" | "completed"; createdAt: string;
}>;
export type StaffWorkspaceData = Readonly<{
  members: readonly StaffWorkspaceMember[]; requests: readonly StaffAuthRequest[]; available: boolean;
}>;
export type StaffWorkspaceActionState = Readonly<{
  status: "idle" | "success" | "error"; message: string;
}>;
export const STAFF_WORKSPACE_INITIAL_STATE: StaffWorkspaceActionState = { status: "idle", message: "" };
export const STAFF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && STAFF_ROLES.includes(value as StaffRole);
}
