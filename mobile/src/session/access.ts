// Маршрутизатор сессии: порт iPhone `SessionRouter.resolveAccess` и
// `ApplicationAccessPolicy` (ios/EVOAdmissions/Services/SessionRouter.swift,
// ApplicationIntakePolicy.swift). Чистая логика без React и Supabase SDK.
import { RpcError } from "@/lib/rpc";

export type AccessTier = "approved" | "assisted";

export type CurrentActorAuthority = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  organizationId: string;
  displayName: string;
  platformRole: string;
  platformAccessVersion: number;
}>;

export type StudentPortalCase = Readonly<{
  id: string;
  studentDisplayName: string;
  targetCountry: string | null;
  caseState: string;
  portalActivatedAt: string | null;
}>;

export type PortalSession = Readonly<{
  authority: CurrentActorAuthority;
  portalCase: StudentPortalCase;
  tier: AccessTier;
}>;

export type StudentSessionIdentity = Readonly<{
  email: string | null;
  emailConfirmed: boolean;
  /** `app_metadata.evo_staff_password_request_id`, если есть. */
  staffProvisionMarker: string | null;
  /** `user_metadata.student_application_draft` проходит validateStudentApplicationDraft веба. */
  metadataDraftPresent: boolean;
}>;

export type ApplicationStatusValue = "pending" | "approved" | "rejected";

export type OwnApplication = Readonly<{ status: ApplicationStatusValue }>;

export type NetworkErrorKey = "error.offline" | "error.server";

export type SessionState =
  | { kind: "signedOut"; accountDeleted: boolean }
  | { kind: "authenticating" }
  | { kind: "resolvingAccess" }
  | { kind: "active"; session: PortalSession }
  | { kind: "needsApplication"; entry: { signedInEmail: string | null; resume: boolean } }
  | { kind: "applicationStatus"; application: OwnApplication }
  | { kind: "accessPending" }
  | { kind: "networkError"; messageKey: NetworkErrorKey };

export type AuthorityRoute = "active" | "accessPending" | "applicationFlow";
export type ApplicationRoute = "accessPending" | "status" | "resumeSubmit" | "wizard";

/** `caseState == pending` -> approved (самостоятельный студент); active/closed -> assisted. */
export function accessTier(caseState: string): AccessTier {
  return caseState === "pending" ? "approved" : "assisted";
}

/** ApplicationAccessPolicy.authorityRoute. `isStudent == null`: нет строки полномочий. */
export function authorityRoute(isStudent: boolean | null, caseCount: number): AuthorityRoute {
  if (isStudent === null) return "applicationFlow";
  if (!isStudent) return "accessPending";
  if (caseCount === 1) return "active";
  return caseCount === 0 ? "applicationFlow" : "accessPending";
}

/** ApplicationAccessPolicy.applicationRoute (student-signup-runtime.ts:40-61). */
export function applicationRoute(input: {
  emailConfirmed: boolean;
  passwordProvisionedStaff: boolean;
  hasApplication: boolean;
  metadataDraftValid: boolean;
}): ApplicationRoute {
  if (!input.emailConfirmed || input.passwordProvisionedStaff) return "accessPending";
  if (input.hasApplication) return "status";
  return input.metadataDraftValid ? "resumeSubmit" : "wizard";
}

export function isPasswordProvisionedStaff(marker: string | null | undefined): boolean {
  return typeof marker === "string" && marker.length > 0;
}

/** Только прямой отказ «пользователь не найден» значит удалённый аккаунт (миграция 280). */
export function isDeletedUserCode(code: string | null | undefined): boolean {
  return code === "user_not_found";
}

export type AccessDeps = Readonly<{
  currentActorAuthority(): Promise<CurrentActorAuthority | null>;
  studentPortalCases(): Promise<readonly StudentPortalCase[]>;
  studentSessionIdentity(): Promise<StudentSessionIdentity>;
  ownStudentApplication(): Promise<OwnApplication | null>;
  /** `auth.getUser()` вернул `user_not_found`. */
  authUserIsDeleted(): Promise<boolean>;
  /** Локальный выход (scope local), чтобы показать вход с пометкой «Аккаунт удалён». */
  signOutLocal(): Promise<void>;
}>;

function networkErrorKey(error: unknown): NetworkErrorKey | null {
  if (error instanceof RpcError) {
    if (error.kind === "transport") return "error.offline";
    if (error.kind === "server") return "error.server";
  }
  return null;
}

async function routeAccessPending(deps: AccessDeps): Promise<SessionState> {
  if (await deps.authUserIsDeleted()) {
    try {
      await deps.signOutLocal();
    } catch {
      // Локальный выход не удался: всё равно показываем вход с пометкой, а не «ждём доступ».
    }
    return { kind: "signedOut", accountDeleted: true };
  }
  return { kind: "accessPending" };
}

async function resolveApplicationFlow(deps: AccessDeps): Promise<SessionState> {
  try {
    const identity = await deps.studentSessionIdentity();
    const application = await deps.ownStudentApplication();
    switch (
      applicationRoute({
        emailConfirmed: identity.emailConfirmed,
        passwordProvisionedStaff: isPasswordProvisionedStaff(identity.staffProvisionMarker),
        hasApplication: application !== null,
        metadataDraftValid: identity.metadataDraftPresent,
      })
    ) {
      case "accessPending":
        return routeAccessPending(deps);
      case "status":
        return application ? { kind: "applicationStatus", application } : routeAccessPending(deps);
      case "resumeSubmit":
        // Черновик из user_metadata отправляет NeedsApplicationScreen (features/registration), expected_revision 0.
        return { kind: "needsApplication", entry: { signedInEmail: identity.email, resume: true } };
      case "wizard":
        return { kind: "needsApplication", entry: { signedInEmail: identity.email, resume: false } };
    }
  } catch (error) {
    const key = networkErrorKey(error);
    return key ? { kind: "networkError", messageKey: key } : routeAccessPending(deps);
  }
}

/** SessionRouter.resolveAccess: current_actor_authority -> student_portal_cases -> маршрут. */
export async function resolveAccess(deps: AccessDeps): Promise<SessionState> {
  try {
    const authority = await deps.currentActorAuthority();
    const isStudent = authority === null ? null : authority.platformRole === "student";
    const cases = isStudent === true ? await deps.studentPortalCases() : [];
    switch (authorityRoute(isStudent, cases.length)) {
      case "active": {
        const portalCase = cases[0];
        if (!authority || cases.length !== 1 || !portalCase) return routeAccessPending(deps);
        return { kind: "active", session: { authority, portalCase, tier: accessTier(portalCase.caseState) } };
      }
      case "accessPending":
        return routeAccessPending(deps);
      case "applicationFlow":
        return resolveApplicationFlow(deps);
    }
  } catch (error) {
    const key = networkErrorKey(error);
    return key ? { kind: "networkError", messageKey: key } : routeAccessPending(deps);
  }
}
