export interface WahaConfig {
  baseUrl: string;
  sessionName: string;
  apiKey?: string | null;
}

export interface WahaSendTextInput {
  to: string;
  text: string;
}

export interface WahaSendTextPayload {
  session: string;
  chatId: string;
  text: string;
}

export interface WahaSendResult {
  whatsappMessageId: string;
  raw: unknown;
}

export interface WahaSessionStatus {
  name: string | null;
  status: string;
  ready: boolean;
  raw: unknown;
}

export class WahaConfigurationError extends Error {
  readonly code = 'waha_not_configured';
  readonly status = 400;
  readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(`WAHA configuration is missing: ${missingFields.join(', ')}`);
    this.name = 'WahaConfigurationError';
    this.missingFields = missingFields;
  }
}

export class WahaProviderError extends Error {
  readonly code = 'waha_provider_error';
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WahaProviderError';
    this.status = status;
  }
}

type FetchLike = typeof fetch;

interface ValidatedWahaConfig {
  baseUrl: string;
  sessionName: string;
  apiKey: string;
}

export function normalizeWahaBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function toWahaChatId(value: string): string {
  const raw = value.trim();
  if (raw.includes('@')) return raw;

  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    throw new WahaConfigurationError(['chatId']);
  }
  return `${digits}@c.us`;
}

export function buildWahaSendTextPayload(input: {
  sessionName: string;
  to: string;
  text: string;
}): WahaSendTextPayload {
  return {
    session: input.sessionName,
    chatId: toWahaChatId(input.to),
    text: input.text,
  };
}

function validateWahaConfig(config: WahaConfig): ValidatedWahaConfig {
  const missingFields: string[] = [];
  const baseUrl = config.baseUrl?.trim() ?? '';
  const sessionName = config.sessionName?.trim() ?? '';
  const apiKey = config.apiKey?.trim() ?? '';
  if (!baseUrl) missingFields.push('baseUrl');
  if (!sessionName) missingFields.push('sessionName');
  if (!apiKey) missingFields.push('apiKey');
  if (missingFields.length > 0) {
    throw new WahaConfigurationError(missingFields);
  }

  return {
    baseUrl: normalizeWahaBaseUrl(baseUrl),
    sessionName,
    apiKey,
  };
}

function jsonHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  };
}

function extractWahaMessageId(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const obj = data as Record<string, unknown>;
  if (typeof obj.id === 'string') return obj.id;
  if (typeof obj.messageId === 'string') return obj.messageId;

  const dataObj = obj._data;
  if (dataObj && typeof dataObj === 'object') {
    const id = (dataObj as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
  }

  const key = obj.key;
  if (key && typeof key === 'object') {
    const id = (key as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
  }

  return '';
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

export async function sendWahaText(
  config: WahaConfig,
  input: WahaSendTextInput,
  fetchImpl: FetchLike = fetch,
): Promise<WahaSendResult> {
  const safeConfig = validateWahaConfig(config);
  const payload = buildWahaSendTextPayload({
    sessionName: safeConfig.sessionName,
    to: input.to,
    text: input.text,
  });

  const response = await fetchImpl(`${safeConfig.baseUrl}/api/sendText`, {
    method: 'POST',
    headers: jsonHeaders(safeConfig.apiKey),
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);

  if (!response.ok) {
    throw new WahaProviderError(
      `WAHA sendText failed with ${response.status}`,
      response.status,
    );
  }

  return {
    whatsappMessageId: extractWahaMessageId(data),
    raw: data,
  };
}

export function parseWahaSessionStatus(data: unknown): WahaSessionStatus {
  const obj =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const status =
    typeof obj.status === 'string' ? obj.status.toUpperCase() : 'UNKNOWN';
  const name = typeof obj.name === 'string' ? obj.name : null;

  return {
    name,
    status,
    ready: status === 'WORKING',
    raw: data,
  };
}

export async function getWahaSessionStatus(
  config: WahaConfig,
  fetchImpl: FetchLike = fetch,
): Promise<WahaSessionStatus> {
  const safeConfig = validateWahaConfig(config);
  const session = encodeURIComponent(safeConfig.sessionName);
  const response = await fetchImpl(`${safeConfig.baseUrl}/api/sessions/${session}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Api-Key': safeConfig.apiKey,
    },
  });
  const data = await readJson(response);

  if (!response.ok) {
    throw new WahaProviderError(
      `WAHA session status failed with ${response.status}`,
      response.status,
    );
  }

  return parseWahaSessionStatus(data);
}
