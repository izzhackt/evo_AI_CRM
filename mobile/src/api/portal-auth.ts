// Узкие серверные маршруты кабинета для входа (план раздел S: S2, S3, S4).
// Это единственное место, где приложение ходит на {portal}/api/portal/*.
// Тела ответов и тексты ошибок сервера наружу не отдаются: только классы исходов.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PortalSessionTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  expiresIn: number;
  tokenType: string;
  mustSetPassword: boolean;
}>;

// Сотрудники получают тот же 401, что и неверный пароль (разбор безопасности): отдельного исхода нет.
export type SignInFailure = "invalid_credentials" | "rate_limited" | "invalid_request" | "unavailable" | "network";
export type SignInResult = { ok: true; session: PortalSessionTokens } | { ok: false; reason: SignInFailure };

export type RecoveryResult = { ok: true } | { ok: false; reason: "rate_limited" | "unavailable" | "network" };

export type SetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "weak_password" | "unauthorized" | "staff_account" | "rate_limited" | "unavailable" | "network" };

/** Смена пароля из «Профиля» (S4 с `current_password`). */
export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrong_current" | "weak_password" | "same_password" | "invalid_request" | "unauthorized" | "staff_account" | "rate_limited" | "unavailable" | "network" };

export type PortalAuthApi = Readonly<{
  signIn(login: string, password: string): Promise<SignInResult>;
  requestPasswordRecovery(email: string): Promise<RecoveryResult>;
  setOwnPassword(accessToken: string, password: string): Promise<SetPasswordResult>;
  changeOwnPassword(accessToken: string, currentPassword: string, newPassword: string): Promise<ChangePasswordResult>;
}>;

const TIMEOUT_MS = 20_000;

export function createPortalAuthApi(options: { baseUrl: string; fetch?: FetchLike }): PortalAuthApi {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  type Raw = { status: number; json: unknown } | { network: true };

  async function post(path: string, body: unknown, bearer?: string): Promise<Raw> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { status: response.status, json };
    } catch {
      return { network: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async signIn(login, password) {
      const raw = await post("/api/portal/mobile/session", { login, password });
      if ("network" in raw) return { ok: false, reason: "network" };
      switch (raw.status) {
        case 200: {
          const session = parseSession(raw.json);
          return session ? { ok: true, session } : { ok: false, reason: "unavailable" };
        }
        case 400:
          return { ok: false, reason: "invalid_request" };
        case 401:
          return { ok: false, reason: "invalid_credentials" };
        case 429:
          return { ok: false, reason: "rate_limited" };
        default:
          return { ok: false, reason: "unavailable" };
      }
    },

    async requestPasswordRecovery(email) {
      const raw = await post("/api/portal/password-recovery", { email });
      if ("network" in raw) return { ok: false, reason: "network" };
      if (raw.status === 200 && isRecord(raw.json) && raw.json.ok === true) return { ok: true };
      if (raw.status === 429) return { ok: false, reason: "rate_limited" };
      return { ok: false, reason: "unavailable" };
    },

    async setOwnPassword(accessToken, password) {
      const raw = await post("/api/portal/mobile/password", { password }, accessToken);
      if ("network" in raw) return { ok: false, reason: "network" };
      if (raw.status === 200 && isRecord(raw.json) && raw.json.ok === true) return { ok: true };
      // 503 revoke_failed: пароль уже сменён, отзыв остальных сессий не удался; для студента это успех.
      if (raw.status === 503 && isRecord(raw.json) && raw.json.error === "revoke_failed" && raw.json.password_changed === true) return { ok: true };
      if (raw.status === 400) return { ok: false, reason: "weak_password" };
      if (raw.status === 403) return { ok: false, reason: "staff_account" };
      if (raw.status === 401) return { ok: false, reason: "unauthorized" };
      if (raw.status === 429) return { ok: false, reason: "rate_limited" };
      return { ok: false, reason: "unavailable" };
    },

    async changeOwnPassword(accessToken, currentPassword, newPassword) {
      const raw = await post("/api/portal/mobile/password", { password: newPassword, current_password: currentPassword }, accessToken);
      if ("network" in raw) return { ok: false, reason: "network" };
      if (raw.status === 200 && isRecord(raw.json) && raw.json.ok === true) return { ok: true };
      // 503 revoke_failed: пароль уже сменён, отзыв остальных сессий не удался; для студента это успех.
      if (raw.status === 503 && isRecord(raw.json) && raw.json.error === "revoke_failed" && raw.json.password_changed === true) return { ok: true };
      const code = isRecord(raw.json) && typeof raw.json.error === "string" ? raw.json.error : null;
      if (raw.status === 400) {
        if (code === "same_password") return { ok: false, reason: "same_password" };
        if (code === "weak_password") return { ok: false, reason: "weak_password" };
        return { ok: false, reason: "invalid_request" };
      }
      if (raw.status === 403) return { ok: false, reason: code === "invalid_current_password" ? "wrong_current" : "staff_account" };
      if (raw.status === 401) return { ok: false, reason: "unauthorized" };
      if (raw.status === 429) return { ok: false, reason: "rate_limited" };
      return { ok: false, reason: "unavailable" };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSession(json: unknown): PortalSessionTokens | null {
  if (!isRecord(json)) return null;
  const { access_token, refresh_token, expires_at, expires_in, token_type, must_set_password } = json;
  if (typeof access_token !== "string" || access_token === "") return null;
  if (typeof refresh_token !== "string" || refresh_token === "") return null;
  if (typeof expires_at !== "number" || typeof expires_in !== "number") return null;
  if (typeof token_type !== "string") return null;
  if (must_set_password !== undefined && typeof must_set_password !== "boolean") return null;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: expires_at,
    expiresIn: expires_in,
    tokenType: token_type,
    mustSetPassword: must_set_password === true,
  };
}
