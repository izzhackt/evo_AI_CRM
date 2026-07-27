export const STAFF_ROLES = ["admin", "sales", "curator", "finance"] as const;
export const ROLES = [...STAFF_ROLES, "client"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
