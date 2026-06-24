import { getSetting, setSetting } from "./db";
import type {
  AmoCrmAccountBaseUrl,
  AmoCrmAdapter,
  AmoCrmConnectionState,
  AmoCrmContactPayload,
  AmoCrmCustomFieldValue,
  AmoCrmEntityRef,
  AmoCrmLeadPayload,
  AmoCrmLeadSyncInput,
  AmoCrmSyncResult,
  AmoCrmTokenSet,
} from "./contracts/amo-crm";

const REQUIRED_SETTING_KEYS = [
  "accountBaseUrl",
  "clientId",
  "clientSecret",
  "redirectUri",
  "refreshToken",
] as const;

type RequiredSettingKey = (typeof REQUIRED_SETTING_KEYS)[number];

export type AmoCrmSettings = {
  readonly accountBaseUrl: AmoCrmAccountBaseUrl | null;
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly redirectUri: string | null;
  readonly refreshToken: string | null;
  readonly pipelineId: number | null;
  readonly statusId: number | null;
  readonly responsibleUserId: number | null;
  readonly targetCountryFieldId: number | null;
  readonly sourceFieldId: number | null;
  readonly invalidReason: string | null;
  readonly lastCheck: string | null;
};

export type AmoCrmLocalStatus =
  | {
      readonly status: "configured";
      readonly accountBaseUrl: AmoCrmAccountBaseUrl;
    }
  | {
      readonly status: "not_configured";
      readonly missing: readonly RequiredSettingKey[];
    }
  | {
      readonly status: "blocked";
      readonly reason: string;
    };

type AmoCrmTokenResponse = {
  readonly token_type?: string;
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
};

type AmoCrmEmbeddedResponse<T extends string> = {
  readonly _embedded?: Partial<Record<T, readonly { readonly id?: number }[]>>;
};

export function normalizeAmoCrmAccountBaseUrl(raw: string): AmoCrmAccountBaseUrl | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (/[^\x00-\x7F]/.test(value)) return null;
  const withHost = value.includes(".") ? value : `${value}.amocrm.ru`;
  const withProtocol = /^https?:\/\//.test(withHost) ? withHost : `https://${withHost}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.port) return null;

  const parts = url.hostname.split(".");
  if (parts.length !== 3) return null;
  const [subdomain, domain, tld] = parts;
  if (domain !== "amocrm" || (tld !== "ru" && tld !== "com")) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(subdomain)) return null;

  return `https://${subdomain}.amocrm.${tld}` as AmoCrmAccountBaseUrl;
}

export function readAmoCrmSettings(): AmoCrmSettings {
  const rawBaseUrl = getSetting("amocrm_account_base_url");
  const accountBaseUrl = rawBaseUrl ? normalizeAmoCrmAccountBaseUrl(rawBaseUrl) : null;
  return {
    accountBaseUrl,
    clientId: emptyToNull(getSetting("amocrm_client_id")),
    clientSecret: emptyToNull(getSetting("amocrm_client_secret")),
    redirectUri: emptyToNull(getSetting("amocrm_redirect_uri")),
    refreshToken: emptyToNull(getSetting("amocrm_refresh_token")),
    pipelineId: toPositiveInt(getSetting("amocrm_pipeline_id")),
    statusId: toPositiveInt(getSetting("amocrm_status_id")),
    responsibleUserId: toPositiveInt(getSetting("amocrm_responsible_user_id")),
    targetCountryFieldId: toPositiveInt(getSetting("amocrm_target_country_field_id")),
    sourceFieldId: toPositiveInt(getSetting("amocrm_source_field_id")),
    invalidReason: rawBaseUrl && !accountBaseUrl ? "invalid_account_domain" : emptyToNull(getSetting("amocrm_last_error")),
    lastCheck: emptyToNull(getSetting("amocrm_last_check")),
  };
}

export function getAmoCrmLocalStatus(
  settings = readAmoCrmSettings(),
  options: { readonly includeLastCheck?: boolean } = {},
): AmoCrmLocalStatus {
  if (settings.invalidReason) return { status: "blocked", reason: settings.invalidReason };
  const missing = missingRequired(settings);
  if (missing.length > 0) return { status: "not_configured", missing };
  const accountBaseUrl = settings.accountBaseUrl;
  if (!accountBaseUrl) return { status: "not_configured", missing: ["accountBaseUrl"] };
  const lastBlockedReason = options.includeLastCheck === false ? null : blockedReasonFromLastCheck(settings.lastCheck);
  if (lastBlockedReason) return { status: "blocked", reason: lastBlockedReason };
  return { status: "configured", accountBaseUrl };
}

export function buildAmoCrmLeadPayload(input: AmoCrmLeadSyncInput, settings = readAmoCrmSettings()): AmoCrmLeadPayload {
  const pipelineId = input.mapping?.pipeline.pipelineId ?? settings.pipelineId ?? 0;
  const statusId = input.mapping?.pipeline.statusId ?? settings.statusId ?? 0;
  const customFieldsValues = [
    ...input.payload.customFieldsValues,
    ...customTextField(settings.targetCountryFieldId, input.payload.targetCountry),
    ...customTextField(settings.sourceFieldId, input.payload.source),
  ];
  return {
    ...input.payload,
    responsibleUserId: input.payload.responsibleUserId ?? settings.responsibleUserId,
    pipeline: { pipelineId, statusId },
    customFieldsValues,
  };
}

export function createAmoCrmAdapter(): AmoCrmAdapter {
  return {
    async getConnectionState() {
      const settings = readAmoCrmSettings();
      const local = getAmoCrmLocalStatus(settings);
      if (local.status === "not_configured") return local;
      if (local.status === "blocked") return local;
      const token = await refreshAccessToken(settings);
      if (token.status !== "synced") return tokenToBlocked(token);
      return {
        status: "configured",
        accountBaseUrl: local.accountBaseUrl,
        token: token.remote,
      };
    },
    async upsertContact(payload) {
      const token = await requireToken();
      if (token.status !== "synced") return token;
      const body = [toAmoCrmContactPayload(payload)];
      return createEntity("contacts", "/api/v4/contacts", body, token.remote);
    },
    async upsertLead(input) {
      const token = await requireToken();
      if (token.status !== "synced") return token;
      const payload = buildAmoCrmLeadPayload(input);
      if (!payload.pipeline.pipelineId || !payload.pipeline.statusId) {
        return { status: "blocked", reason: "missing_pipeline_mapping" };
      }
      const body = [toAmoCrmLeadPayload(payload)];
      return createEntity("leads", "/api/v4/leads", body, token.remote);
    },
    async linkContactToLead(link) {
      const token = await requireToken();
      if (token.status !== "synced") return token;
      const result = await amoFetch(`/api/v4/leads/${link.lead.id}/link`, token.remote, {
        method: "POST",
        body: JSON.stringify([{ to_entity_id: link.contact.id, to_entity_type: "contacts" }]),
      });
      if (result.ok) {
        return { status: "synced", remote: link, syncedAt: now() };
      }
      return providerFailure(result);
    },
    async fetchLead(remoteLeadId) {
      const token = await requireToken();
      if (token.status !== "synced") return token;
      const result = await amoFetch(`/api/v4/leads/${remoteLeadId}`, token.remote);
      if (!result.ok) return providerFailure(result);
      const data = await result.json() as Partial<{
        name: string;
        price: number | null;
        responsible_user_id: number | null;
        pipeline_id: number;
        status_id: number;
        custom_fields_values: unknown;
      }>;
      return {
        status: "synced",
        syncedAt: now(),
        remote: {
          name: data.name ?? `amoCRM lead ${remoteLeadId}`,
          price: data.price ?? null,
          responsibleUserId: data.responsible_user_id ?? null,
          pipeline: { pipelineId: data.pipeline_id ?? 0, statusId: data.status_id ?? 0 },
          source: null,
          targetCountry: null,
          localStatus: "new",
          customFieldsValues: [],
          contact: null,
        },
      };
    },
  };
}

async function requireToken(): Promise<AmoCrmSyncResult<AmoCrmTokenSet>> {
  const settings = readAmoCrmSettings();
  const local = getAmoCrmLocalStatus(settings, { includeLastCheck: false });
  if (local.status === "not_configured") return { status: "not_configured", missing: local.missing };
  if (local.status === "blocked") return { status: "blocked", reason: local.reason };
  return refreshAccessToken(settings);
}

async function refreshAccessToken(settings: AmoCrmSettings): Promise<AmoCrmSyncResult<AmoCrmTokenSet>> {
  const local = getAmoCrmLocalStatus(settings, { includeLastCheck: false });
  if (local.status === "not_configured") return { status: "not_configured", missing: local.missing };
  if (local.status === "blocked") return { status: "blocked", reason: local.reason };

  const result = await rawAmoFetch(`${local.accountBaseUrl}/oauth2/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: "refresh_token",
      refresh_token: settings.refreshToken,
      redirect_uri: settings.redirectUri,
    }),
  });
  if (!result.ok) return providerFailure(result);

  const data = await result.json() as AmoCrmTokenResponse;
  if (data.token_type !== "Bearer" || !data.access_token || !data.refresh_token || !data.expires_in) {
    return { status: "failed", providerStatus: result.status, errorCode: "invalid_token_response", retryable: false };
  }

  setSetting("amocrm_refresh_token", data.refresh_token);
  const token = {
    tokenType: "Bearer",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    receivedAt: now(),
  } satisfies AmoCrmTokenSet;
  return { status: "synced", remote: token, syncedAt: token.receivedAt };
}

async function createEntity<T extends "contacts" | "leads">(
  entity: T,
  path: string,
  body: readonly Record<string, unknown>[],
  token: AmoCrmTokenSet,
): Promise<AmoCrmSyncResult<AmoCrmEntityRef>> {
  const result = await amoFetch(path, token, { method: "POST", body: JSON.stringify(body) });
  if (!result.ok) return providerFailure(result);
  const data = await result.json() as AmoCrmEmbeddedResponse<T>;
  const id = data._embedded?.[entity]?.[0]?.id;
  if (!id) {
    return { status: "failed", providerStatus: result.status, errorCode: "missing_entity_id", retryable: false };
  }
  return { status: "synced", remote: { entityType: entity, id }, syncedAt: now() };
}

async function amoFetch(path: string, token: AmoCrmTokenSet, init: RequestInit = {}) {
  const settings = readAmoCrmSettings();
  if (!settings.accountBaseUrl) {
    return new Response("missing amoCRM account URL", { status: 400 });
  }
  return rawAmoFetch(`${settings.accountBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function rawAmoFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    return new Response("amoCRM network error", { status: 503 });
  }
}

function toAmoCrmContactPayload(payload: AmoCrmContactPayload) {
  return pruneEmpty({
    name: payload.name,
    first_name: payload.firstName,
    last_name: payload.lastName,
    responsible_user_id: payload.responsibleUserId,
    custom_fields_values: [
      ...payload.customFieldsValues,
      ...codedField("PHONE", payload.phone, "WORK"),
      ...codedField("EMAIL", payload.email, "WORK"),
    ].map(toAmoCrmCustomField),
  });
}

function toAmoCrmLeadPayload(payload: AmoCrmLeadPayload) {
  return pruneEmpty({
    name: payload.name,
    price: payload.price,
    responsible_user_id: payload.responsibleUserId,
    pipeline_id: payload.pipeline.pipelineId,
    status_id: payload.pipeline.statusId,
    custom_fields_values: payload.customFieldsValues.map(toAmoCrmCustomField),
  });
}

function toAmoCrmCustomField(field: AmoCrmCustomFieldValue) {
  if ("fieldId" in field) {
    return { field_id: field.fieldId, values: field.values.map(toAmoCrmCustomFieldValue) };
  }
  return { field_code: field.fieldCode, values: field.values.map(toAmoCrmCustomFieldValue) };
}

function toAmoCrmCustomFieldValue(value: AmoCrmCustomFieldValue["values"][number]) {
  return pruneEmpty({
    value: value.value,
    enum_code: value.enumCode,
    enum_id: value.enumId,
  });
}

function providerFailure(result: Response): AmoCrmSyncResult<never> {
  return {
    status: "failed",
    providerStatus: result.status || null,
    errorCode: result.status === 503 ? "network_error" : "provider_error",
    retryable: result.status === 429 || result.status >= 500,
  };
}

function tokenToBlocked(result: AmoCrmSyncResult<AmoCrmTokenSet>): AmoCrmConnectionState {
  if (result.status === "not_configured") return { status: "not_configured", missing: result.missing };
  if (result.status === "blocked") return result;
  if (result.status === "failed") return { status: "blocked", reason: `provider_${result.providerStatus ?? "unavailable"}` };
  return { status: "blocked", reason: "unknown_provider_state" };
}

function missingRequired(settings: AmoCrmSettings): RequiredSettingKey[] {
  return REQUIRED_SETTING_KEYS.filter((key) => !settings[key]);
}

function blockedReasonFromLastCheck(lastCheck: string | null): string | null {
  if (!lastCheck?.startsWith("blocked:")) return null;
  return lastCheck.slice("blocked:".length).trim() || "provider_error";
}

function codedField(fieldCode: "PHONE" | "EMAIL", value: string | null, enumCode: string): AmoCrmCustomFieldValue[] {
  if (!value) return [];
  return [{ fieldCode, values: [{ value, enumCode }] }];
}

function customTextField(fieldId: number | null, value: string | null): AmoCrmCustomFieldValue[] {
  if (!fieldId || !value) return [];
  return [{ fieldId, values: [{ value }] }];
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function toPositiveInt(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function pruneEmpty(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

function now() {
  return new Date().toISOString();
}
