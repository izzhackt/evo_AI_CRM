import { RpcError } from "@/lib/rpc";
import {
  accessTier,
  applicationRoute,
  authorityRoute,
  isDeletedUserCode,
  isPasswordProvisionedStaff,
  resolveAccess,
  type AccessDeps,
  type CurrentActorAuthority,
  type StudentPortalCase,
  type StudentSessionIdentity,
} from "@/session/access";

// Таблица маршрутов портирована из ApplicationIntakePolicyTests (iPhone 1.1).
describe("authorityRoute", () => {
  it("staff -> accessPending; студент с 1 делом -> active; без дела -> анкета; 2+ -> accessPending; без полномочий -> анкета", () => {
    expect(authorityRoute(false, 0)).toBe("accessPending");
    expect(authorityRoute(true, 1)).toBe("active");
    expect(authorityRoute(true, 0)).toBe("applicationFlow");
    expect(authorityRoute(true, 2)).toBe("accessPending");
    expect(authorityRoute(null, 0)).toBe("applicationFlow");
  });
});

describe("applicationRoute (resumeStudentApplication)", () => {
  const base = { emailConfirmed: true, passwordProvisionedStaff: false, hasApplication: false, metadataDraftValid: false };
  it("не подтверждённая почта или маркер сотрудника никогда не забирают черновик", () => {
    expect(applicationRoute({ ...base, emailConfirmed: false, metadataDraftValid: true })).toBe("accessPending");
    expect(applicationRoute({ ...base, passwordProvisionedStaff: true, hasApplication: true })).toBe("accessPending");
  });
  it("существующая анкета побеждает", () => {
    expect(applicationRoute({ ...base, hasApplication: true, metadataDraftValid: true })).toBe("status");
  });
  it("валидный черновик из метаданных отправляется, иначе мастер", () => {
    expect(applicationRoute({ ...base, metadataDraftValid: true })).toBe("resumeSubmit");
    expect(applicationRoute(base)).toBe("wizard");
  });
});

describe("правила", () => {
  it("маркер сотрудника: только непустая строка", () => {
    expect(isPasswordProvisionedStaff(null)).toBe(false);
    expect(isPasswordProvisionedStaff("")).toBe(false);
    expect(isPasswordProvisionedStaff("req-1")).toBe(true);
  });
  it("уровень доступа: pending -> approved; active и closed -> assisted", () => {
    expect(accessTier("pending")).toBe("approved");
    expect(accessTier("active")).toBe("assisted");
    expect(accessTier("closed")).toBe("assisted");
  });
  it("удалённый аккаунт — только user_not_found", () => {
    expect(isDeletedUserCode("user_not_found")).toBe(true);
    expect(isDeletedUserCode("session_not_found")).toBe(false);
    expect(isDeletedUserCode(undefined)).toBe(false);
  });
});

// Синтетические данные.
const authority = (platformRole: string): CurrentActorAuthority => ({
  authUserId: "00000000-0000-4000-8000-000000000001",
  profileId: "p",
  membershipId: "m",
  organizationId: "o",
  displayName: "Test Student",
  platformRole,
  platformAccessVersion: 1,
});
const portalCase = (caseState: string): StudentPortalCase => ({ id: "c1", studentDisplayName: "Test Student", targetCountry: null, caseState, portalActivatedAt: null });
const identity = (over: Partial<StudentSessionIdentity> = {}): StudentSessionIdentity => ({
  email: "student@example.test",
  emailConfirmed: true,
  staffProvisionMarker: null,
  metadataDraftPresent: false,
  ...over,
});

function deps(over: Partial<AccessDeps> = {}) {
  const signOutLocal = jest.fn(async () => undefined);
  const value: AccessDeps = {
    currentActorAuthority: async () => authority("student"),
    studentPortalCases: async () => [portalCase("pending")],
    studentSessionIdentity: async () => identity(),
    ownStudentApplication: async () => null,
    authUserIsDeleted: async () => false,
    signOutLocal,
    ...over,
  };
  return { value, signOutLocal };
}

describe("resolveAccess", () => {
  it("студент с делом pending -> active/approved", async () => {
    const state = await resolveAccess(deps().value);
    expect(state).toMatchObject({ kind: "active", session: { tier: "approved" } });
  });
  it.each(["active", "closed"])("дело %s -> assisted", async (caseState) => {
    const state = await resolveAccess(deps({ studentPortalCases: async () => [portalCase(caseState)] }).value);
    expect(state).toMatchObject({ kind: "active", session: { tier: "assisted" } });
  });
  it("student_portal_cases не читается у сотрудника, и он получает accessPending", async () => {
    const cases = jest.fn(async () => [portalCase("active")]);
    const state = await resolveAccess(deps({ currentActorAuthority: async () => authority("admin"), studentPortalCases: cases }).value);
    expect(state).toEqual({ kind: "accessPending" });
    expect(cases).not.toHaveBeenCalled();
  });
  it("два дела -> accessPending", async () => {
    const state = await resolveAccess(deps({ studentPortalCases: async () => [portalCase("active"), portalCase("active")] }).value);
    expect(state).toEqual({ kind: "accessPending" });
  });
  it("студент без дела и без анкеты -> needsApplication (мастер)", async () => {
    const state = await resolveAccess(deps({ studentPortalCases: async () => [] }).value);
    expect(state).toEqual({ kind: "needsApplication", entry: { signedInEmail: "student@example.test", resume: false } });
  });
  it("без полномочий, но с черновиком в метаданных -> needsApplication/resume", async () => {
    const state = await resolveAccess(
      deps({ currentActorAuthority: async () => null, studentSessionIdentity: async () => identity({ metadataDraftPresent: true }) }).value,
    );
    expect(state).toMatchObject({ kind: "needsApplication", entry: { resume: true } });
  });
  it("есть анкета -> applicationStatus", async () => {
    const state = await resolveAccess(
      deps({ studentPortalCases: async () => [], ownStudentApplication: async () => ({ status: "pending" }) }).value,
    );
    expect(state).toEqual({ kind: "applicationStatus", application: { status: "pending" } });
  });
  it("почта не подтверждена -> accessPending", async () => {
    const state = await resolveAccess(deps({ studentPortalCases: async () => [], studentSessionIdentity: async () => identity({ emailConfirmed: false }) }).value);
    expect(state).toEqual({ kind: "accessPending" });
  });
  it("обрыв -> networkError offline; 5xx -> server; без текстов сервера", async () => {
    await expect(resolveAccess(deps({ currentActorAuthority: async () => { throw new RpcError("transport"); } }).value)).resolves.toEqual({ kind: "networkError", messageKey: "error.offline" });
    await expect(resolveAccess(deps({ currentActorAuthority: async () => { throw new RpcError("server", null, 503); } }).value)).resolves.toEqual({ kind: "networkError", messageKey: "error.server" });
  });
  it("прочая ошибка -> accessPending", async () => {
    const state = await resolveAccess(deps({ currentActorAuthority: async () => { throw new RpcError("forbidden", "42501", 403); } }).value);
    expect(state).toEqual({ kind: "accessPending" });
  });
  it("удалённый аккаунт: локальный выход и вход с пометкой «Аккаунт удалён»", async () => {
    const d = deps({ currentActorAuthority: async () => authority("admin"), authUserIsDeleted: async () => true });
    const state = await resolveAccess(d.value);
    expect(state).toEqual({ kind: "signedOut", accountDeleted: true });
    expect(d.signOutLocal).toHaveBeenCalledTimes(1);
  });
});
