export interface AmoCrmConfig {
  baseUrl: string;
  accessToken: string;
  pipelineId?: number | string | null;
  statusId?: number | string | null;
  responsibleUserId?: number | string | null;
}

export interface AmoCrmContact {
  id: string;
  name: string | null;
  leadId?: string | null;
  raw?: unknown;
}

export interface AmoCrmLead {
  id: string;
  name: string | null;
  raw?: unknown;
}

export interface AmoCrmClient {
  findContactByPhone(phone: string): Promise<AmoCrmContact | null>;
  createContact(input: { phone: string; name?: string | null }): Promise<AmoCrmContact>;
  createLead(input: { contactId: string; name: string }): Promise<AmoCrmLead>;
}

export class AmoCrmConfigurationError extends Error {
  readonly code = 'amocrm_not_configured';
  readonly status = 400;
  readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(`amoCRM configuration is missing: ${missingFields.join(', ')}`);
    this.name = 'AmoCrmConfigurationError';
    this.missingFields = missingFields;
  }
}

export class AmoCrmProviderError extends Error {
  readonly code = 'amocrm_provider_error';
  readonly status: number;
  readonly responseBody: unknown;

  constructor(message: string, status: number, responseBody: unknown) {
    super(message);
    this.name = 'AmoCrmProviderError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

type FetchLike = typeof fetch;

export function normalizeAmoCrmBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function normalizePhoneE164(phone: string): string {
  const digits = normalizePhoneDigits(phone);
  return digits ? `+${digits}` : '';
}

function numericId(value: string | number | null | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function validateConfig(config: AmoCrmConfig): Required<AmoCrmConfig> {
  const missingFields: string[] = [];
  const baseUrl = normalizeAmoCrmBaseUrl(config.baseUrl);
  if (!baseUrl) missingFields.push('baseUrl');
  if (!config.accessToken?.trim()) missingFields.push('accessToken');
  if (missingFields.length > 0) {
    throw new AmoCrmConfigurationError(missingFields);
  }

  return {
    baseUrl,
    accessToken: config.accessToken.trim(),
    pipelineId: config.pipelineId ?? null,
    statusId: config.statusId ?? null,
    responsibleUserId: config.responsibleUserId ?? null,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function firstEmbedded(data: unknown, key: 'contacts' | 'leads'): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const embedded = (data as Record<string, unknown>)._embedded;
  if (!embedded || typeof embedded !== 'object') return null;
  const rows = (embedded as Record<string, unknown>)[key];
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') {
    return null;
  }
  return rows[0] as Record<string, unknown>;
}

function extractLeadId(contact: Record<string, unknown>): string | null {
  const embedded = contact._embedded;
  if (!embedded || typeof embedded !== 'object') return null;
  const leads = (embedded as Record<string, unknown>).leads;
  if (!Array.isArray(leads) || !leads[0] || typeof leads[0] !== 'object') {
    return null;
  }
  const id = (leads[0] as Record<string, unknown>).id;
  return id == null ? null : String(id);
}

function contactPhones(contact: Record<string, unknown>): string[] {
  const values = contact.custom_fields_values;
  if (!Array.isArray(values)) return [];
  const phones: string[] = [];
  for (const field of values) {
    if (!field || typeof field !== 'object') continue;
    const row = field as Record<string, unknown>;
    if (row.field_code !== 'PHONE') continue;
    if (!Array.isArray(row.values)) continue;
    for (const valueRow of row.values) {
      if (!valueRow || typeof valueRow !== 'object') continue;
      const value = (valueRow as Record<string, unknown>).value;
      if (typeof value === 'string') phones.push(normalizePhoneDigits(value));
    }
  }
  return phones;
}

function toContact(row: Record<string, unknown>): AmoCrmContact {
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : null,
    leadId: extractLeadId(row),
    raw: row,
  };
}

function toLead(row: Record<string, unknown>): AmoCrmLead {
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : null,
    raw: row,
  };
}

export function createAmoCrmClient(
  config: AmoCrmConfig,
  fetchImpl: FetchLike = fetch,
): AmoCrmClient {
  const safeConfig = validateConfig(config);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetchImpl(`${safeConfig.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${safeConfig.accessToken}`,
        ...(init.headers ?? {}),
      },
    });
    const data = await readJson(response);
    if (!response.ok) {
      throw new AmoCrmProviderError(
        `amoCRM API failed with ${response.status}`,
        response.status,
        data,
      );
    }
    return data;
  }

  return {
    async findContactByPhone(phone: string): Promise<AmoCrmContact | null> {
      const digits = normalizePhoneDigits(phone);
      const params = new URLSearchParams({ query: digits, with: 'leads' });
      const data = await request(`/api/v4/contacts?${params.toString()}`);
      const embedded =
        data && typeof data === 'object'
          ? (data as Record<string, unknown>)._embedded
          : null;
      const contacts =
        embedded && typeof embedded === 'object'
          ? (embedded as Record<string, unknown>).contacts
          : null;
      if (!Array.isArray(contacts)) return null;

      const match =
        contacts.find((row) => {
          if (!row || typeof row !== 'object') return false;
          const phones = contactPhones(row as Record<string, unknown>);
          return phones.includes(digits);
        }) ?? null;

      return match && typeof match === 'object'
        ? toContact(match as Record<string, unknown>)
        : null;
    },

    async createContact(input): Promise<AmoCrmContact> {
      const phone = normalizePhoneE164(input.phone);
      const name = input.name?.trim() || phone;
      const data = await request('/api/v4/contacts', {
        method: 'POST',
        body: JSON.stringify([
          {
            name,
            custom_fields_values: [
              {
                field_code: 'PHONE',
                values: [{ value: phone, enum_code: 'WORK' }],
              },
            ],
          },
        ]),
      });
      const row = firstEmbedded(data, 'contacts');
      if (!row) {
        throw new AmoCrmProviderError(
          'amoCRM contact create response did not include a contact id',
          502,
          data,
        );
      }
      return toContact(row);
    },

    async createLead(input): Promise<AmoCrmLead> {
      const body: Record<string, unknown> = {
        name: input.name,
        _embedded: {
          contacts: [
            {
              id: numericId(input.contactId),
              is_main: true,
            },
          ],
        },
      };
      const pipelineId = numericId(safeConfig.pipelineId);
      const statusId = numericId(safeConfig.statusId);
      const responsibleUserId = numericId(safeConfig.responsibleUserId);
      if (pipelineId !== undefined) body.pipeline_id = pipelineId;
      if (statusId !== undefined) body.status_id = statusId;
      if (responsibleUserId !== undefined) {
        body.responsible_user_id = responsibleUserId;
      }

      const data = await request('/api/v4/leads', {
        method: 'POST',
        body: JSON.stringify([body]),
      });
      const row = firstEmbedded(data, 'leads');
      if (!row) {
        throw new AmoCrmProviderError(
          'amoCRM lead create response did not include a lead id',
          502,
          data,
        );
      }
      return toLead(row);
    },
  };
}
