// Реальные зависимости маршрутизатора: RPC платформы и сессия Supabase.
import type { AppSupabase } from "@/lib/supabase";
import { RpcError, rpcRead, type RpcTransport } from "@/lib/rpc";
import { validateStudentApplicationDraft } from "@/features/registration/application-contract";
import {
  isDeletedUserCode,
  type AccessDeps,
  type CurrentActorAuthority,
  type OwnApplication,
  type StudentPortalCase,
  type StudentSessionIdentity,
} from "@/session/access";

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function malformed(): never {
  // Неожиданная форма ответа: не показываем и не логируем её, считаем сбоем сервера.
  throw new RpcError("unknown");
}

export function decodeAuthority(rows: unknown): CurrentActorAuthority | null {
  if (!Array.isArray(rows)) return malformed();
  if (rows.length === 0) return null;
  if (rows.length > 1) return malformed();
  const r = rows[0];
  if (!isRow(r)) return malformed();
  const role = str(r.platform_role);
  const id = str(r.auth_user_id);
  if (!role || !id) return malformed();
  return {
    authUserId: id,
    profileId: str(r.profile_id) ?? "",
    membershipId: str(r.membership_id) ?? "",
    organizationId: str(r.organization_id) ?? "",
    displayName: str(r.display_name) ?? "",
    platformRole: role,
    platformAccessVersion: typeof r.platform_access_version === "number" ? r.platform_access_version : 0,
  };
}

export function decodeCases(rows: unknown): StudentPortalCase[] {
  if (!Array.isArray(rows)) return malformed();
  return rows.map((r) => {
    if (!isRow(r)) return malformed();
    const id = str(r.case_id);
    const caseState = str(r.case_state);
    if (!id || !caseState) return malformed();
    return {
      id,
      studentDisplayName: str(r.student_display_name) ?? "",
      targetCountry: str(r.target_country),
      caseState,
      portalActivatedAt: str(r.portal_activated_at),
    };
  });
}

export function decodeOwnApplication(value: unknown): OwnApplication | null {
  if (value === null || value === undefined) return null;
  if (!isRow(value)) return malformed();
  const status = value.status;
  if (status !== "pending" && status !== "approved" && status !== "rejected") return malformed();
  return { status };
}

export function createAccessDeps(supabase: AppSupabase, transport: RpcTransport): AccessDeps {
  return {
    async currentActorAuthority() {
      return decodeAuthority(await rpcRead(transport, "current_actor_authority"));
    },
    async studentPortalCases() {
      return decodeCases(await rpcRead(transport, "student_portal_cases"));
    },
    async studentSessionIdentity(): Promise<StudentSessionIdentity> {
      const { data, error } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (error || !user) throw new RpcError("unknown");
      const marker = user.app_metadata?.evo_staff_password_request_id;
      const draft = user.user_metadata?.student_application_draft;
      return {
        email: user.email ?? null,
        emailConfirmed: Boolean(user.email_confirmed_at),
        staffProvisionMarker: typeof marker === "string" ? marker : null,
        // Строгий валидатор веба: чужая форма в метаданных не считается черновиком.
        metadataDraftPresent: validateStudentApplicationDraft(draft) !== null,
      };
    },
    async ownStudentApplication() {
      return decodeOwnApplication(await rpcRead(transport, "own_student_application_v1"));
    },
    async authUserIsDeleted() {
      try {
        const { error } = await supabase.auth.getUser();
        return error ? isDeletedUserCode(error.code) : false;
      } catch {
        return false;
      }
    },
    async signOutLocal() {
      await supabase.auth.signOut({ scope: "local" });
    },
  };
}
