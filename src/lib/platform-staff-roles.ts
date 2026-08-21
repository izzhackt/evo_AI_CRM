/**
 * Staff role and membership vocabulary.
 *
 * Kept free of framework imports so the contract can be asserted without a
 * server runtime, and so a drift between this list and the database enum is
 * caught by a plain unit test.
 */

export const PLATFORM_STAFF_ROLES = [
  "admin",
  "sales",
  "curator",
  "finance",
] as const;
export type PlatformStaffRole = (typeof PLATFORM_STAFF_ROLES)[number];

export const PLATFORM_MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "inactive",
  "blocked",
] as const;
export type PlatformMembershipStatus =
  (typeof PLATFORM_MEMBERSHIP_STATUSES)[number];

/**
 * `student` is a real platform role but never a staff role. Offering it on the
 * staff surface would let an administrator move a colleague onto the client
 * surface by accident.
 */
export function isPlatformStaffRole(value: string): value is PlatformStaffRole {
  return (PLATFORM_STAFF_ROLES as readonly string[]).includes(value);
}

export function isPlatformMembershipStatus(
  value: string,
): value is PlatformMembershipStatus {
  return (PLATFORM_MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}
