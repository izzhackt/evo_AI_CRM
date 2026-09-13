export const STAFF_ROLES = ["admin", "sales", "curator"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Администратор", sales: "Продажи", curator: "Поступление",
};
export type StaffWorkspaceMember = Readonly<{
  membershipId: string; displayName: string; role: StaffRole; status: string; version: number;
  metadata: Readonly<{
    version: number; departmentId: string | null; jobTitle: string | null;
    directions: readonly AdmissionsDirection[];
  }>;
}>;
export type StaffDepartment = Readonly<{
  id: string; name: string; description: string | null;
  status: "active" | "archived"; version: number; memberCount: number;
}>;
export type StaffAuthRequest = Readonly<{
  requestId: string; operation: "invite" | "recovery"; displayName: string;
  status: "dispatching" | "reconciliation_required" | "completed" | "rejected"; createdAt: string;
  rejectionCode: string | null;
}>;
export type StaffWorkspaceData = Readonly<{
  members: readonly StaffWorkspaceMember[]; requests: readonly StaffAuthRequest[]; available: boolean;
  departments: readonly StaffDepartment[];
}>;
export type StaffWorkspaceActionState = Readonly<{
  status: "idle" | "success" | "error"; message: string;
  retryAllowed?: boolean;
  metadataOutcome?: "unknown";
}>;
export const STAFF_WORKSPACE_INITIAL_STATE: StaffWorkspaceActionState = { status: "idle", message: "" };
export const STAFF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && STAFF_ROLES.includes(value as StaffRole);
}

export function staffAuthRejectionMessage(code: string | null | undefined): string {
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "Сервис входа отклонил запрос из-за ограничения частоты. Подождите перед новым запросом.";
  if (code === "email_address_not_authorized") return "Почтовый сервис не разрешает отправку этому адресату. Администратору нужно проверить настройки SMTP.";
  if (code === "email_address_invalid") return "Сервис входа отклонил email. Проверьте рабочий адрес сотрудника.";
  if (code === "email_exists") return "Этот email уже зарегистрирован. Проверьте существующий аккаунт перед новым запросом.";
  if (code === "not_admin" || code === "bad_jwt" || code === "no_authorization") return "Сервис входа отклонил серверные полномочия. Администратору нужно проверить настройку доступа к Auth.";
  return "Сервис входа отклонил запрос. Администратору нужно проверить настройки Auth перед новым запросом.";
}
import type { AdmissionsDirection } from "../platform-admissions-playbook-contract";
