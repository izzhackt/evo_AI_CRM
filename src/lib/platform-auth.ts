import { currentUser } from "./auth";
import type { DevelopmentGateRole } from "./development-gate-core";
import type { Role } from "./roles";

// Only DEVELOPMENT_PLATFORM_ROLES can be issued by the V2 gate. The three
// historical values remain in the shared repository actor type until the
// already approved UI/repository deletion slices #427/#429.
export const DEVELOPMENT_PLATFORM_ROLES = [
  "admin",
  "sales",
  "admissions",
] as const satisfies readonly DevelopmentGateRole[];

export const PLATFORM_ROLES = [
  ...DEVELOPMENT_PLATFORM_ROLES,
  "curator",
  "finance",
  "student",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type PlatformActor = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  platformRole: PlatformRole;
  platformAccessVersion: number;
  platformBundleId: string;
  platformBundleVersion: number;
  /**
   * Temporary accepted-shell projection. Authorization uses platformRole;
   * #427 deletes the historical role UI and this field with it.
   */
  role: Role;
}>;

export type PlatformActorInvalidReason = "development_session_invalid";

export type PlatformActorResult =
  | Readonly<{ status: "anonymous"; actor: null }>
  | Readonly<{
      status: "invalid";
      actor: null;
      reason: PlatformActorInvalidReason;
    }>
  | Readonly<{ status: "authenticated"; actor: PlatformActor }>;

const LOCAL_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const LOCAL_BUNDLE_ID = "00000000-0000-4000-8000-000000000002";

const TECHNICAL_ACTOR_IDS = {
  admin: {
    authUserId: "00000000-0000-4000-8000-000000000101",
    profileId: "00000000-0000-4000-8000-000000000201",
    membershipId: "00000000-0000-4000-8000-000000000301",
  },
  sales: {
    authUserId: "00000000-0000-4000-8000-000000000102",
    profileId: "00000000-0000-4000-8000-000000000202",
    membershipId: "00000000-0000-4000-8000-000000000302",
  },
  admissions: {
    authUserId: "00000000-0000-4000-8000-000000000103",
    profileId: "00000000-0000-4000-8000-000000000203",
    membershipId: "00000000-0000-4000-8000-000000000303",
  },
} as const satisfies Record<
  DevelopmentGateRole,
  Readonly<{
    authUserId: string;
    profileId: string;
    membershipId: string;
  }>
>;

export async function resolvePlatformActor(): Promise<PlatformActorResult> {
  const user = await currentUser();
  if (!user) return { status: "anonymous", actor: null };

  const ids = TECHNICAL_ACTOR_IDS[user.developmentRole];
  return {
    status: "authenticated",
    actor: {
      ...ids,
      organizationId: LOCAL_ORGANIZATION_ID,
      displayName: user.name,
      platformRole: user.developmentRole,
      platformAccessVersion: 1,
      platformBundleId: LOCAL_BUNDLE_ID,
      platformBundleVersion: 1,
      role: user.role,
    },
  };
}
