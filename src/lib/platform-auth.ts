import { currentUser } from "./auth";
import type { DevelopmentGateRole } from "./development-gate-core";

// Only DEVELOPMENT_PLATFORM_ROLES can be issued by the active V2 gate.
export const DEVELOPMENT_PLATFORM_ROLES = [
  "admin",
  "sales",
  "admissions",
] as const satisfies readonly DevelopmentGateRole[];

export const HISTORICAL_PLATFORM_ROLES = [
  "curator",
  "finance",
  "student",
] as const;

export type HistoricalPlatformRole = (typeof HISTORICAL_PLATFORM_ROLES)[number];
export type PlatformRole = DevelopmentGateRole | HistoricalPlatformRole;

export type PlatformActor<
  Role extends PlatformRole = DevelopmentGateRole,
> = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  platformRole: Role;
  authorityRole: DevelopmentGateRole;
  platformAccessVersion: number;
  platformBundleId: string;
  platformBundleVersion: number;
}>;

/** The only actor shape the active V2 development gate can resolve. */
export type ActivePlatformActor = PlatformActor<DevelopmentGateRole>;

/**
 * Explicit repository-only tail for code that expires in #429 or the frozen
 * student portal. The active resolver never creates this broad actor shape.
 */
export type HistoricalRepositoryActor = PlatformActor<PlatformRole>;

export type PlatformActorInvalidReason = "development_session_invalid";

export type PlatformActorResult =
  | Readonly<{ status: "anonymous"; actor: null }>
  | Readonly<{
      status: "invalid";
      actor: null;
      reason: PlatformActorInvalidReason;
    }>
  | Readonly<{ status: "authenticated"; actor: ActivePlatformActor }>;

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

  const ids = TECHNICAL_ACTOR_IDS[user.role];
  return {
    status: "authenticated",
    actor: {
      ...ids,
      organizationId: LOCAL_ORGANIZATION_ID,
      displayName: user.name,
      platformRole: user.role,
      authorityRole: user.authorityRole,
      platformAccessVersion: 1,
      platformBundleId: LOCAL_BUNDLE_ID,
      platformBundleVersion: 1,
    },
  };
}
