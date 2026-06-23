import type {
  DateTimeString,
  EntityId,
  Lead,
  LeadStatus,
} from "../domain";

export type AmoCrmAccountBaseUrl = `https://${string}.amocrm.ru` | `https://${string}.amocrm.com`;

export type AmoCrmTokenSet = {
  readonly tokenType: "Bearer";
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly receivedAt: DateTimeString;
};

export type AmoCrmConnectionState =
  | {
      readonly status: "configured";
      readonly accountBaseUrl: AmoCrmAccountBaseUrl;
      readonly token: AmoCrmTokenSet;
    }
  | {
      readonly status: "not_configured";
      readonly missing: readonly ("accountBaseUrl" | "clientId" | "clientSecret" | "redirectUri" | "refreshToken")[];
    }
  | {
      readonly status: "blocked";
      readonly reason: string;
    };

export type AmoCrmEntityType = "leads" | "contacts" | "companies";

export type AmoCrmEntityRef = {
  readonly entityType: AmoCrmEntityType;
  readonly id: number;
};

export type AmoCrmPipelineRef = {
  readonly pipelineId: number;
  readonly statusId: number;
};

export type AmoCrmCustomFieldValue =
  | {
      readonly fieldId: number;
      readonly values: readonly {
        readonly value: string | number | boolean;
        readonly enumCode?: string;
        readonly enumId?: number;
      }[];
    }
  | {
      readonly fieldCode: string;
      readonly values: readonly {
        readonly value: string | number | boolean;
        readonly enumCode?: string;
        readonly enumId?: number;
      }[];
    };

export type AmoCrmContactPayload = {
  readonly name: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly responsibleUserId: number | null;
  readonly customFieldsValues: readonly AmoCrmCustomFieldValue[];
};

export type AmoCrmLeadPayload = {
  readonly name: string;
  readonly price: number | null;
  readonly responsibleUserId: number | null;
  readonly pipeline: AmoCrmPipelineRef;
  readonly source: string | null;
  readonly targetCountry: string | null;
  readonly localStatus: LeadStatus;
  readonly customFieldsValues: readonly AmoCrmCustomFieldValue[];
  readonly contact: AmoCrmContactPayload | null;
};

export type AmoCrmLeadMapping = {
  readonly localLeadId: EntityId;
  readonly remoteLeadId: number | null;
  readonly remoteContactId: number | null;
  readonly pipeline: AmoCrmPipelineRef;
  readonly lastSyncedAt: DateTimeString | null;
};

export type AmoCrmLeadSyncInput = {
  readonly lead: Lead;
  readonly mapping: AmoCrmLeadMapping | null;
  readonly payload: AmoCrmLeadPayload;
};

export type AmoCrmSyncResult<T> =
  | {
      readonly status: "synced";
      readonly remote: T;
      readonly syncedAt: DateTimeString;
    }
  | {
      readonly status: "not_configured";
      readonly missing: AmoCrmConnectionState extends { readonly status: "not_configured"; readonly missing: infer M }
        ? M
        : never;
    }
  | {
      readonly status: "blocked";
      readonly reason: string;
    }
  | {
      readonly status: "failed";
      readonly providerStatus: number | null;
      readonly errorCode: string;
      readonly retryable: boolean;
    };

export type AmoCrmEntityLink = {
  readonly lead: AmoCrmEntityRef & { readonly entityType: "leads" };
  readonly contact: AmoCrmEntityRef & { readonly entityType: "contacts" };
};

export type AmoCrmAdapter = {
  readonly getConnectionState: () => Promise<AmoCrmConnectionState>;
  readonly upsertLead: (input: AmoCrmLeadSyncInput) => Promise<AmoCrmSyncResult<AmoCrmEntityRef>>;
  readonly upsertContact: (payload: AmoCrmContactPayload) => Promise<AmoCrmSyncResult<AmoCrmEntityRef>>;
  readonly linkContactToLead: (link: AmoCrmEntityLink) => Promise<AmoCrmSyncResult<AmoCrmEntityLink>>;
  readonly fetchLead: (remoteLeadId: number) => Promise<AmoCrmSyncResult<AmoCrmLeadPayload>>;
};
