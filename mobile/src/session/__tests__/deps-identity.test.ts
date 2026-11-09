import { createAccessDeps } from "@/session/deps";
import { resolveAccess } from "@/session/access";
import { RpcError } from "@/lib/rpc";
import { validDraft } from "@/test-fixtures/registration";

function supabaseWith(user: Record<string, unknown>) {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      getUser: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
  } as never;
}

const noRpc = (async () => ({ data: null, error: null })) as never;

describe("studentSessionIdentity: строгий черновик из метаданных", () => {
  const base = { email: "me@example.test", email_confirmed_at: "2026-11-09T00:00:00Z", app_metadata: {} };

  it("валидный черновик регистрации считается черновиком", async () => {
    const deps = createAccessDeps(supabaseWith({ ...base, user_metadata: { student_application_draft: validDraft() } }), noRpc);
    expect((await deps.studentSessionIdentity()).metadataDraftPresent).toBe(true);
  });

  it.each([
    ["пустой объект", {}],
    ["чужая форма", { firstName: "Тест" }],
    ["согласие снято", { ...validDraft(), consent: false }],
    ["строка", "draft"],
    ["null", null],
  ])("%s не считается черновиком", async (_name, draft) => {
    const deps = createAccessDeps(supabaseWith({ ...base, user_metadata: { student_application_draft: draft } }), noRpc);
    expect((await deps.studentSessionIdentity()).metadataDraftPresent).toBe(false);
  });

  it("маркер сотрудника и неподтверждённая почта читаются как есть", async () => {
    const deps = createAccessDeps(supabaseWith({ email: "s@example.test", email_confirmed_at: null, app_metadata: { evo_staff_password_request_id: "req" }, user_metadata: {} }), noRpc);
    const identity = await deps.studentSessionIdentity();
    expect(identity.emailConfirmed).toBe(false);
    expect(identity.staffProvisionMarker).toBe("req");
  });

  it("без сессии — сбой, а не пустая личность", async () => {
    const supabase = { auth: { getSession: async () => ({ data: { session: null }, error: null }) } } as never;
    await expect(createAccessDeps(supabase, noRpc).studentSessionIdentity()).rejects.toBeInstanceOf(RpcError);
  });
});

describe("маршрут через реальные зависимости", () => {
  it("студент без дела с валидным черновиком в метаданных -> needsApplication/resume", async () => {
    const rows: Record<string, unknown> = {
      current_actor_authority: [],
      own_student_application_v1: null,
    };
    const transport = (async (name: string) => ({ data: rows[name] ?? null, error: null })) as never;
    const supabase = supabaseWith({ email: "me@example.test", email_confirmed_at: "x", app_metadata: {}, user_metadata: { student_application_draft: validDraft() } });
    const state = await resolveAccess(createAccessDeps(supabase, transport));
    expect(state).toEqual({ kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: true } });
  });

  it("без черновика -> мастер; со своей анкетой -> статус", async () => {
    const supabase = supabaseWith({ email: "me@example.test", email_confirmed_at: "x", app_metadata: {}, user_metadata: {} });
    const wizard = await resolveAccess(createAccessDeps(supabase, (async (name: string) => ({ data: name === "current_actor_authority" ? [] : null, error: null })) as never));
    expect(wizard).toEqual({ kind: "needsApplication", entry: { signedInEmail: "me@example.test", resume: false } });
    const status = await resolveAccess(createAccessDeps(supabase, (async (name: string) => ({ data: name === "current_actor_authority" ? [] : { status: "rejected" }, error: null })) as never));
    expect(status).toEqual({ kind: "applicationStatus", application: { status: "rejected" } });
  });
});
