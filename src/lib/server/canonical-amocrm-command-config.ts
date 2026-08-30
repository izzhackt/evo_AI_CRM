import "server-only";

const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,9}$/u;
const MAX_PROVIDER_ID = "2147483647";
const MAX_TAG_NAME_BYTES = 128;

export type CanonicalAmoCrmCommandConfigField =
  | "sales_pipeline_id"
  | "sales_status_id"
  | "sales_responsible_user_id"
  | "sales_tag_name"
  | "admissions_pipeline_id"
  | "admissions_status_id"
  | "admissions_responsible_user_id"
  | "admissions_tag_name";

export type CanonicalAmoCrmCommandConfigurationErrorCode =
  | "configuration_missing"
  | "invalid_provider_id"
  | "invalid_tag_name";

export class CanonicalAmoCrmCommandConfigurationError extends Error {
  readonly code: CanonicalAmoCrmCommandConfigurationErrorCode;
  readonly field: CanonicalAmoCrmCommandConfigField;

  constructor(
    code: CanonicalAmoCrmCommandConfigurationErrorCode,
    field: CanonicalAmoCrmCommandConfigField,
  ) {
    super(`Canonical amoCRM command routing is not configured: ${field}.`);
    this.name = "CanonicalAmoCrmCommandConfigurationError";
    this.code = code;
    this.field = field;
  }
}

export type CanonicalAmoCrmRoleCommandRoute = Readonly<{
  pipelineId: string;
  statusId: string;
  responsibleUserId: string;
  tagName: string;
}>;

export type CanonicalAmoCrmCommandConfig = Readonly<{
  sales: CanonicalAmoCrmRoleCommandRoute;
  admissions: CanonicalAmoCrmRoleCommandRoute;
}>;

function required(
  value: string | undefined,
  field: CanonicalAmoCrmCommandConfigField,
): string {
  if (value === undefined || value === "") {
    throw new CanonicalAmoCrmCommandConfigurationError(
      "configuration_missing",
      field,
    );
  }
  return value;
}

function providerId(
  value: string | undefined,
  field: CanonicalAmoCrmCommandConfigField,
): string {
  const parsed = required(value, field);
  if (
    !PROVIDER_ID_PATTERN.test(parsed) ||
    parsed.length > MAX_PROVIDER_ID.length ||
    (parsed.length === MAX_PROVIDER_ID.length && parsed > MAX_PROVIDER_ID)
  ) {
    throw new CanonicalAmoCrmCommandConfigurationError(
      "invalid_provider_id",
      field,
    );
  }
  return parsed;
}

function tagName(
  value: string | undefined,
  field: CanonicalAmoCrmCommandConfigField,
): string {
  const parsed = required(value, field);
  if (
    parsed !== parsed.trim() ||
    /[\u0000-\u001f\u007f]/u.test(parsed) ||
    Buffer.byteLength(parsed, "utf8") > MAX_TAG_NAME_BYTES
  ) {
    throw new CanonicalAmoCrmCommandConfigurationError("invalid_tag_name", field);
  }
  return parsed;
}

function route(
  environment: Readonly<Record<string, string | undefined>>,
  role: "sales" | "admissions",
): CanonicalAmoCrmRoleCommandRoute {
  const prefix = role === "sales" ? "SALES" : "ADMISSIONS";
  return Object.freeze({
    pipelineId: providerId(
      environment[`EVO_V2_AMOCRM_${prefix}_PIPELINE_ID`],
      `${role}_pipeline_id`,
    ),
    statusId: providerId(
      environment[`EVO_V2_AMOCRM_${prefix}_STATUS_ID`],
      `${role}_status_id`,
    ),
    responsibleUserId: providerId(
      environment[`EVO_V2_AMOCRM_${prefix}_RESPONSIBLE_USER_ID`],
      `${role}_responsible_user_id`,
    ),
    tagName: tagName(
      environment[`EVO_V2_AMOCRM_${prefix}_TAG_NAME`],
      `${role}_tag_name`,
    ),
  });
}

export function loadCanonicalAmoCrmCommandConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalAmoCrmCommandConfig {
  return Object.freeze({
    sales: route(environment, "sales"),
    admissions: route(environment, "admissions"),
  });
}
