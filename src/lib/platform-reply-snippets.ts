import { fixedRoleCan } from "./fixed-role-policy.ts";
import type { PlatformActor } from "./platform-auth.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9]\d*$/;
const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;
const BODY_CONTROL_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F]/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform reply-snippet data is unavailable.";

export const PLATFORM_REPLY_SNIPPET_AUDIENCES = [
  "sales",
  "admissions",
  "all",
] as const;

export type PlatformReplySnippetAudience =
  (typeof PLATFORM_REPLY_SNIPPET_AUDIENCES)[number];

export const PLATFORM_REPLY_SNIPPET_TITLE_MAX_LENGTH = 120;
export const PLATFORM_REPLY_SNIPPET_BODY_MAX_LENGTH = 2_000;

/** Match PostgreSQL char_length(text): limits are Unicode code points. */
export function platformReplySnippetCodePointLength(value: string): number {
  return Array.from(value).length;
}

/** Match PostgreSQL btrim(value, ' '): only ASCII SPACE is structural. */
export function normalizePlatformReplySnippetTitle(value: string): string {
  return value.replace(/^\u0020+|\u0020+$/gu, "");
}

/**
 * Match PostgreSQL btrim(value, E' \\n'): trim ASCII SPACE and edge LF while
 * retaining every internal LF in the multi-line WhatsApp body.
 */
export function normalizePlatformReplySnippetBody(value: string): string {
  return value.replace(/^[\u0020\n]+|[\u0020\n]+$/gu, "");
}

export type PlatformReplySnippet = Readonly<{
  replySnippetId: string;
  audience: PlatformReplySnippetAudience;
  title: string;
  body: string;
  version: string;
  createdByMembershipId: string;
  createdByDisplayName: string;
  createdAt: string;
  updatedAt: string;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformReplySnippetsRpcClient = Readonly<{
  schema(name: "platform"): Readonly<{
    rpc(
      name: "list_reply_snippets",
      args: Readonly<{ p_organization_id: string; p_audience?: string }>,
      options: Readonly<{ get: true }>,
    ): Promise<RpcResponse>;
  }>;
}>;

export type PlatformReplySnippetsDependencies = Readonly<{
  client?: PlatformReplySnippetsRpcClient;
}>;

export class PlatformReplySnippetsRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformReplySnippetsRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformReplySnippetsRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformReplySnippetsRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  return value.toLowerCase();
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value)) {
    return invalidShape();
  }
  return value;
}

function positiveBigint(value: unknown): string {
  if (typeof value !== "string" || !POSITIVE_BIGINT_PATTERN.test(value)) {
    return invalidShape();
  }
  return value;
}

export function isPlatformReplySnippetAudience(
  value: unknown,
): value is PlatformReplySnippetAudience {
  return (
    typeof value === "string" &&
    (PLATFORM_REPLY_SNIPPET_AUDIENCES as readonly string[]).includes(value)
  );
}

/** An unknown audience key from the database never reaches the screen raw. */
function snippetAudience(value: unknown): PlatformReplySnippetAudience {
  if (!isPlatformReplySnippetAudience(value)) return invalidShape();
  return value;
}

function snippetTitle(value: unknown): string {
  const length = typeof value === "string"
    ? platformReplySnippetCodePointLength(value)
    : 0;
  if (
    typeof value !== "string" || length < 1 ||
    length > PLATFORM_REPLY_SNIPPET_TITLE_MAX_LENGTH ||
    value !== normalizePlatformReplySnippetTitle(value) ||
    SINGLE_LINE_CONTROL_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

/** Snippet bodies are multi-line: LF is content, other controls fail closed. */
function snippetBody(value: unknown): string {
  const length = typeof value === "string"
    ? platformReplySnippetCodePointLength(value)
    : 0;
  if (
    typeof value !== "string" || length < 1 ||
    length > PLATFORM_REPLY_SNIPPET_BODY_MAX_LENGTH ||
    value !== normalizePlatformReplySnippetBody(value) ||
    BODY_CONTROL_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function displayName(value: unknown): string {
  if (
    typeof value !== "string" || value.trim().length < 1 ||
    value.length > 255 || SINGLE_LINE_CONTROL_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

const SNIPPET_ROW_KEYS = [
  "organization_id",
  "reply_snippet_id",
  "audience",
  "title",
  "body",
  "version",
  "created_by_membership_id",
  "created_by_display_name",
  "created_at",
  "updated_at",
] as const;

export function normalizePlatformReplySnippetRow(
  value: unknown,
  expectedOrganizationId: string,
): PlatformReplySnippet {
  if (!isRecord(value) || !exactKeys(value, SNIPPET_ROW_KEYS)) {
    return invalidShape();
  }
  if (requiredUuid(value.organization_id) !== expectedOrganizationId) {
    return invalidShape();
  }
  return Object.freeze({
    replySnippetId: requiredUuid(value.reply_snippet_id),
    audience: snippetAudience(value.audience),
    title: snippetTitle(value.title),
    body: snippetBody(value.body),
    version: positiveBigint(value.version),
    createdByMembershipId: requiredUuid(value.created_by_membership_id),
    createdByDisplayName: displayName(value.created_by_display_name),
    createdAt: timestamp(value.created_at),
    updatedAt: timestamp(value.updated_at),
  });
}

export function normalizePlatformReplySnippets(
  value: unknown,
  expectedOrganizationId: string,
): readonly PlatformReplySnippet[] {
  if (!Array.isArray(value)) return invalidShape();
  const snippets: PlatformReplySnippet[] = [];
  const ids = new Set<string>();
  for (const rawRow of value) {
    const row = normalizePlatformReplySnippetRow(
      rawRow,
      expectedOrganizationId,
    );
    if (ids.has(row.replySnippetId)) return invalidShape();
    ids.add(row.replySnippetId);
    snippets.push(row);
  }
  return Object.freeze(snippets);
}

function requireReplySnippetReader(actor: PlatformActor): string {
  if (!fixedRoleCan(actor.authorityRole, "messaging.read")) {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

async function getPlatformClient(): Promise<PlatformReplySnippetsRpcClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as PlatformReplySnippetsRpcClient;
}

export async function getPlatformReplySnippets(
  actor: PlatformActor,
  audience: PlatformReplySnippetAudience | null = null,
  dependencies: PlatformReplySnippetsDependencies = {},
): Promise<readonly PlatformReplySnippet[]> {
  try {
    if (audience !== null && !isPlatformReplySnippetAudience(audience)) {
      return invalidShape();
    }
    const organizationId = requireReplySnippetReader(actor);
    const client = dependencies.client ?? await getPlatformClient();
    const args = audience === null
      ? { p_organization_id: organizationId }
      : { p_organization_id: organizationId, p_audience: audience };
    const response = await client.schema("platform").rpc(
      "list_reply_snippets",
      args,
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizePlatformReplySnippets(response.data, organizationId);
  } catch (error) {
    return failClosed(error);
  }
}
