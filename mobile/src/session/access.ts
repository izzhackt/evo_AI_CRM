// Маршрутизатор сессии: порт iPhone `SessionRouter.resolveAccess` и
// `ApplicationAccessPolicy` (ios/EVOAdmissions/Services/SessionRouter.swift,
// ApplicationIntakePolicy.swift). Чистая логика без React и Supabase SDK.
import { consentGateRequired, type ConsentStatus } from "@/features/consent/consent-contract";

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
  /** Дело открыто, но нет решения о Политике и ИИ-помощниках (миграция 356): сначала экран «Конфиденциальность». */
  | { kind: "needsConsent"; session: PortalSession }
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
  /** `portal_consent_status_v1`; `null` - форма ответа чужая. Сбой RPC бросает (маршрутизатор открывает кабинет). */
  consentStatus(): Promise<ConsentStatus | null>;
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

/**
 * Миграция 356, решение владельца 09.11.2026: экран «Конфиденциальность» показывается, когда база говорит
 * `needsDecision` И версии базы равны версиям сборки (иначе принятие отвергнуто, а экран нельзя закрыть).
 * Как в вебе (`(portal)/layout.tsx`), сбой чтения или чужая форма ответа кабинет НЕ запирают: доступ ИИ к данным
 * без согласия закрывает база (320). Экран только у студента кабинета; анкета и статус анкеты его не ставят
 * (политику заявитель принимает галочкой анкеты, а сам веб эти шаги тоже не закрывает).
 */
async function consentNeeded(deps: AccessDeps): Promise<boolean> {
  try {
    const status = await deps.consentStatus();
    return status !== null && consentGateRequired(status);
  } catch {
    return false;
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
        const session: PortalSession = { authority, portalCase, tier: accessTier(portalCase.caseState) };
        return (await consentNeeded(deps)) ? { kind: "needsConsent", session } : { kind: "active", session };
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
