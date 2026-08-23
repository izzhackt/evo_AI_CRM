/** U1 vocabulary shared by the staff UI, actions and contract tests. */
export const PLATFORM_STAFF_ROLES = ["admin", "sales", "curator"] as const;
export type PlatformStaffRole = (typeof PLATFORM_STAFF_ROLES)[number];

export const PLATFORM_MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "suspended",
  "inactive",
  "blocked",
] as const;
export type PlatformMembershipStatus =
  (typeof PLATFORM_MEMBERSHIP_STATUSES)[number];

export const PLATFORM_SENSITIVE_PERMISSIONS = [
  "contract.evidence.confirm",
  "finance.first.payment.confirm",
] as const;
export type PlatformSensitivePermission =
  (typeof PLATFORM_SENSITIVE_PERMISSIONS)[number];

export function isPlatformStaffRole(
  value: string,
): value is PlatformStaffRole {
  return (PLATFORM_STAFF_ROLES as readonly string[]).includes(value);
}

export function isPlatformMembershipStatus(
  value: string,
): value is PlatformMembershipStatus {
  return (PLATFORM_MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

export function isPlatformSensitivePermission(
  value: string,
): value is PlatformSensitivePermission {
  return (PLATFORM_SENSITIVE_PERMISSIONS as readonly string[]).includes(value);
}
